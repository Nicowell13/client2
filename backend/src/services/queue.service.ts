import Bull from 'bull';
import prisma from '../lib/prisma';
import wahaService from './waha.service';
import sessionRotation from './session-rotation.service';
import { emitCampaignUpdate, emitMessageUpdate } from './socket.service';
import contentVariation from './content-variation.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ⭐ SINGLE GLOBAL QUEUE for all sessions (safer from WhatsApp bans)
const GLOBAL_QUEUE_NAME = 'campaign-messages-global';
let globalQueue: Bull.Queue<CampaignJob> | null = null;

const GLOBAL_SEND_CONCURRENCY = Number(process.env.GLOBAL_SEND_CONCURRENCY || 0);
const GLOBAL_SEND_KEY = process.env.GLOBAL_SEND_KEY || 'campaign:global_send_active';
// Safety TTL to avoid a stuck counter if the process crashes mid-send.
const GLOBAL_SEND_TTL_MS = Number(process.env.GLOBAL_SEND_TTL_MS || 60_000);

// ===============================
// JOB PAYLOAD INTERFACE
// ===============================
interface CampaignJob {
  campaignId: string;
  contactId: string;
  phoneNumber: string;
  message: string;
  imageUrl: string | null;
  buttons: Array<{ label: string; url: string }>;
  sessionName: string;
  messageIndex: number;
  batchIndex: number;
}

// ========================================================
// DELAY SYSTEM (WHATSAPP SAFE - OPTIMIZED FOR ANTI-BAN)
// ========================================================

// Environment variable untuk kustomisasi delay
const MESSAGE_DELAY_MIN_MS = Number(process.env.MESSAGE_DELAY_MIN_MS || 30000);
const MESSAGE_DELAY_MAX_MS = Number(process.env.MESSAGE_DELAY_MAX_MS || 50000);
const TYPING_INDICATOR_ENABLED = process.env.TYPING_INDICATOR_ENABLED !== 'false';
const READ_RECEIPT_ENABLED = process.env.READ_RECEIPT_ENABLED !== 'false';

function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get time-based delay multiplier
 * Pagi lebih lambat, siang normal, malam sedikit lebih lambat
 */
function getTimeMultiplier(): number {
  const hour = new Date().getHours();

  if (hour >= 10 && hour < 12) return 1.3;  // Pagi: lebih lambat
  if (hour >= 12 && hour < 18) return 1.0;  // Siang: normal
  if (hour >= 18 && hour < 20) return 1.1;  // Sore: sedikit lambat
  if (hour >= 20 && hour < 22) return 1.2;  // Malam: lebih lambat

  return 1.5; // Di luar jam kerja: sangat lambat (jika masih berjalan)
}

function calcMessageDelay(index: number): number {
  // Base delay yang lebih tinggi untuk anti-ban
  const base = random(MESSAGE_DELAY_MIN_MS, MESSAGE_DELAY_MAX_MS);

  // Gradual backoff: grows slowly with index, capped
  const gradual = Math.min(index * random(300, 800), 20000);

  // Occasional cooldown (every 5 messages)
  const periodic = index > 0 && index % 5 === 0 ? random(25000, 50000) : 0;

  // Extra break every 10 messages
  const longBreak = index > 0 && index % 10 === 0 ? random(60000, 90000) : 0;

  // Apply time multiplier
  const timeMultiplier = getTimeMultiplier();

  const delay = Math.floor((base + gradual + periodic + longBreak) * timeMultiplier);

  // Cap at 3 minutes max to avoid looking stuck
  return Math.min(delay, 180000);
}

function batchCooldown(batchIndex: number): number {
  // Cooldown lebih panjang antar batch
  return batchIndex === 0 ? 0 : random(45000, 75000);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ========================================================
// SAFE WA MESSAGE ID NORMALIZER
// ========================================================
function extractWAId(result: any): string | null {
  if (!result) return null;

  if (typeof result.id === 'string') return result.id;

  if (typeof result.id === 'object') {
    if (result.id._serialized) return result.id._serialized;
    if (result.id.id) return String(result.id.id);
  }

  if (result.key?.id) return result.key.id;
  if (result.messageId) return result.messageId;

  return null;
}

async function safeCampaignUpdate(
  campaignId: string,
  data: Parameters<typeof prisma.campaign.updateMany>[0]['data']
) {
  const result = await prisma.campaign.updateMany({
    where: { id: campaignId },
    data,
  });

  if (result.count === 0) {
    console.warn(`⚠ Campaign ${campaignId} not found (skipping update)`);
    return false;
  }

  return true;
}

function normalizeSessionName(input: unknown): string {
  const name = String(input ?? '').trim();
  return name.length > 0 ? name : 'default';
}

function sanitizeQueueSegment(sessionName: string): string {
  // Keep queue names stable & Redis-friendly; avoid spaces / weird chars.
  return sessionName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function buildQueueName(sessionName: string): string {
  // ⭐ Always use global queue (single worker for all sessions)
  return GLOBAL_QUEUE_NAME;
}

async function getRedisClient(): Promise<any> {
  // Bull initializes redis lazily; ensure we have at least the default queue.
  const q = getCampaignQueue('default');
  const clientOrPromise = (q as any).client;
  return await Promise.resolve(clientOrPromise);
}

async function acquireGlobalSendSlot() {
  if (!Number.isFinite(GLOBAL_SEND_CONCURRENCY) || GLOBAL_SEND_CONCURRENCY <= 0) return;

  const client = await getRedisClient();

  // Atomically: INCR, if above limit then DECR and fail.
  const lua = `
    local key = KEYS[1]
    local limit = tonumber(ARGV[1])
    local ttl = tonumber(ARGV[2])
    local new = redis.call('incr', key)
    if new > limit then
      redis.call('decr', key)
      return 0
    end
    redis.call('pexpire', key, ttl)
    return new
  `;

  while (true) {
    const res = await client.eval(lua, 1, GLOBAL_SEND_KEY, String(GLOBAL_SEND_CONCURRENCY), String(GLOBAL_SEND_TTL_MS));
    if (Number(res) > 0) return;
    // Small jitter so multiple workers don't thundering-herd.
    await sleep(random(200, 500));
  }
}

async function releaseGlobalSendSlot() {
  if (!Number.isFinite(GLOBAL_SEND_CONCURRENCY) || GLOBAL_SEND_CONCURRENCY <= 0) return;

  const client = await getRedisClient();

  const lua = `
    local key = KEYS[1]
    local val = redis.call('decr', key)
    if val <= 0 then
      redis.call('del', key)
      return 0
    end
    return val
  `;

  await client.eval(lua, 1, GLOBAL_SEND_KEY);
}

async function processCampaignJob(job: Bull.Job<CampaignJob>) {
  const {
    campaignId,
    contactId,
    phoneNumber,
    message,
    imageUrl,
    buttons,
    sessionName,
    messageIndex,
    batchIndex,
  } = job.data;

  try {
    // ------------------------------------
    // SKIP IF CAMPAIGN DELETED
    // ------------------------------------
    const existingCampaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true },
    });

    if (!existingCampaign) {
      console.warn(`⚠ Campaign ${campaignId} missing; skipping job send`);
      return { success: false, skipped: true, reason: 'campaign-missing' };
    }

    // ------------------------------------
    // CHECK BROADCAST HOURS (ANTI-BAN)
    // ------------------------------------
    if (!sessionRotation.isWithinBroadcastHours()) {
      console.log(`⏰ Outside broadcast hours, job will be delayed`);
      // Re-queue dengan delay sampai jam broadcast mulai
      throw new Error('Outside broadcast hours - will retry later');
    }

    // ------------------------------------
    // CHECK DAILY LIMIT (ANTI-BAN)
    // ------------------------------------
    try {
      const dailyLimitReached = await sessionRotation.checkDailyLimit(sessionName);
      if (dailyLimitReached) {
        console.log(`📊 Session ${sessionName} reached daily limit, marking for retry with other session`);
        // Mark as waiting untuk di-pickup oleh session lain
        await prisma.message.updateMany({
          where: { campaignId, contactId, status: 'pending' },
          data: {
            status: 'waiting',
            errorMsg: 'Daily limit reached, waiting for another session'
          }
        });
        return { success: false, waiting: true, reason: 'daily-limit-reached' };
      }
    } catch (limitError: any) {
      console.warn(`⚠ Daily limit check failed:`, limitError.message);
      // Continue anyway - gagal check bukan berarti harus stop
    }

    // ------------------------------------
    // BATCH COOLDOWN
    // ------------------------------------
    if (messageIndex === 0) {
      const cooldown = batchCooldown(batchIndex);
      console.log(`🧊 Batch ${batchIndex} cooldown ${cooldown}ms`);
      await new Promise((r) => setTimeout(r, cooldown));
    }

    // ------------------------------------
    // PER MESSAGE DELAY
    // ------------------------------------
    const delay = calcMessageDelay(messageIndex);
    console.log(`⏳ Delay ${delay}ms before send (time multiplier: ${getTimeMultiplier()}x)`);
    await new Promise((r) => setTimeout(r, delay));

    // ------------------------------------
    // TRACK ATTEMPT METADATA (for smart job assignment)
    // ------------------------------------
    await prisma.message.updateMany({
      where: { campaignId, contactId, status: 'pending' },
      data: {
        lastAttemptAt: new Date(),
        lastSessionId: sessionName
      } as any
    });

    // ------------------------------------
    // CHECK SESSION STATUS BEFORE SENDING (WITH FAILOVER)
    // ------------------------------------
    let activeSessionName = sessionName;

    try {
      const sessionStatus = await wahaService.getSessionStatus(sessionName);
      const normalizedStatus = (sessionStatus?.status || '').toLowerCase();

      if (!['working', 'ready', 'authenticated'].includes(normalizedStatus)) {
        // Update session status in DB
        const session = await prisma.session.findFirst({
          where: { sessionId: sessionName },
        });

        if (session) {
          await prisma.session.update({
            where: { id: session.id },
            data: { status: normalizedStatus || 'stopped' },
          });
        }

        // ⭐ TRY FAILOVER TO ANOTHER SESSION
        console.log(`⚠ Session ${sessionName} not active (${normalizedStatus}), trying failover...`);
        const failoverSession = await sessionRotation.getFailoverSession(sessionName, messageIndex);

        if (failoverSession) {
          activeSessionName = failoverSession.sessionId;
          console.log(`✅ Failover success: ${sessionName} → ${activeSessionName}`);
        } else {
          throw new Error(`Session ${sessionName} is not active and no failover available. Status: ${normalizedStatus}`);
        }
      }
    } catch (statusError: any) {
      // If status check fails, try failover first
      console.warn(`⚠ Session ${sessionName} status check failed:`, statusError.message);

      // ⭐ TRY FAILOVER
      const failoverSession = await sessionRotation.getFailoverSession(sessionName, messageIndex);

      if (failoverSession) {
        activeSessionName = failoverSession.sessionId;
        console.log(`✅ Failover on error: ${sessionName} → ${activeSessionName}`);
      } else {
        throw new Error(`Session ${sessionName} unavailable and no failover available`);
      }
    }

    // ------------------------------------
    // SEND MESSAGE
    // ------------------------------------
    await acquireGlobalSendSlot();
    let result: any;
    try {
      // Get contact info for template replacement
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { id: true, name: true, phoneNumber: true }
      });

      if (!contact) {
        throw new Error(`Contact ${contactId} not found`);
      }

      // =========================================
      // HUMAN-LIKE BEHAVIOR (ANTI-BAN)
      // =========================================

      // 1. Set presence to available (online)
      try {
        await wahaService.setPresence(activeSessionName, 'available');
      } catch (presenceError: any) {
        console.warn(`[HUMAN] Presence set failed:`, presenceError.message);
      }

      // 2. Mark chat as seen (read receipt) - optional
      if (READ_RECEIPT_ENABLED) {
        try {
          await wahaService.markChatAsSeen(activeSessionName, phoneNumber);
        } catch (seenError: any) {
          console.warn(`[HUMAN] Mark seen failed:`, seenError.message);
        }
      }

      // 3. Send typing indicator before message
      if (TYPING_INDICATOR_ENABLED) {
        // Duration berdasarkan panjang pesan (min 2s, max 8s)
        const typingDuration = Math.min(2000 + message.length * 30, 8000);
        try {
          await wahaService.sendTypingIndicator(activeSessionName, phoneNumber, typingDuration);
        } catch (typingError: any) {
          console.warn(`[HUMAN] Typing indicator failed:`, typingError.message);
        }

        // Extra random delay after typing
        await sleep(random(500, 1500));
      }

      // =========================================
      // CONTENT VARIATION (ANTI-BAN)
      // =========================================

      // Process message with all variations:
      // - Spintext: {Hi|Halo|Hai} → random selection
      // - {{nama}} → contact name
      // - URL params → unique per contact
      // - Fingerprint → invisible variations
      const finalMessage = contentVariation.processMessageTemplate(message, contact);

      // Log untuk debugging - termasuk info nama kontak
      console.log(`[CONTENT] Contact: id=${contact.id}, name="${contact.name}", phone="${contact.phoneNumber}"`);
      console.log(`[CONTENT] Original: "${message.substring(0, 60)}..."`);
      console.log(`[CONTENT] Final: "${finalMessage.substring(0, 60)}..."`);

      // =========================================
      // SEND THE MESSAGE
      // =========================================
      result = await wahaService.sendMessageWithButtons(
        activeSessionName,
        phoneNumber,
        finalMessage,
        imageUrl,
        buttons
      );
    } finally {
      try {
        await releaseGlobalSendSlot();
      } catch (e: any) {
        console.warn('⚠ Failed to release global send slot:', e?.message || e);
      }
    }

    const waMessageId = extractWAId(result);

    // ------------------------------------
    // MARK AS SENT (SUCCESS)
    // ------------------------------------
    await prisma.message.updateMany({
      where: { campaignId, contactId, status: 'pending' },
      data: {
        status: 'sent',
        waMessageId,
        sentAt: new Date(),
      },
    });

    await safeCampaignUpdate(campaignId, { sentCount: { increment: 1 } });

    // ------------------------------------
    // INCREMENT SESSION JOB COUNT
    // ------------------------------------
    try {
      const limitReached = await sessionRotation.incrementJobCount(activeSessionName);
      if (limitReached) {
        console.log(`🛑 Session ${activeSessionName} reached job limit, will rest`);
      }
    } catch (jobCountError: any) {
      console.warn(`⚠ Failed to increment job count:`, jobCountError.message);
    }

    // ------------------------------------
    // INCREMENT DAILY COUNT (ANTI-BAN)
    // ------------------------------------
    try {
      const dailyCount = await sessionRotation.incrementDailyCount(activeSessionName);
      console.log(`📊 Session ${activeSessionName} daily count: ${dailyCount}/${sessionRotation.DAILY_MESSAGE_LIMIT}`);
    } catch (dailyError: any) {
      console.warn(`⚠ Failed to increment daily count:`, dailyError.message);
    }

    // ------------------------------------
    // UPDATE QUALITY SCORE (SUCCESS)
    // ------------------------------------
    try {
      await sessionRotation.updateQualityScore(activeSessionName, true, false);
    } catch (qualityError: any) {
      console.warn(`⚠ Failed to update quality score:`, qualityError.message);
    }

    // ------------------------------------
    // SET CONTACT COOLDOWN (ANTI-SPAM)
    // ------------------------------------
    try {
      await sessionRotation.setContactCooldown(contactId, 24); // 24 jam cooldown
    } catch (cooldownError: any) {
      console.warn(`⚠ Failed to set contact cooldown:`, cooldownError.message);
    }

    return { success: true, messageId: waMessageId };
  } catch (error: any) {
    const errorMsg = String(error?.message || '');

    // =====================================================
    // 🔥 NON-FATAL ERROR HANDLING (IMPORTANT FIX)
    // =====================================================
    // These errors indicate the message was sent successfully,
    // but some optional feature (buttons, media processing) failed.
    // We should mark as SENT to avoid confusion.
    const isNonFatalError =
      errorMsg.includes('addAnnotations') ||
      errorMsg.includes('processMedia') ||
      errorMsg.includes('Cannot read properties') ||
      errorMsg.includes('button') ||
      errorMsg.includes('Button') ||
      errorMsg.includes('interactive') ||
      errorMsg.includes('Interactive') ||
      errorMsg.includes('addButtons') ||
      errorMsg.includes('attachment') ||
      errorMsg.toLowerCase().includes('failed to add buttons') ||
      errorMsg.toLowerCase().includes('button error');

    if (isNonFatalError) {
      console.warn('⚠ Non-fatal error (message likely sent), marking as SENT:', errorMsg);

      await prisma.message.updateMany({
        where: { campaignId, contactId, status: 'pending' },
        data: {
          status: 'sent',
          sentAt: new Date(),
          errorMsg: `Warning: ${errorMsg.substring(0, 200)}`, // Truncate long errors
        },
      });

      await safeCampaignUpdate(campaignId, { sentCount: { increment: 1 } });

      return { success: true, warning: 'non-fatal-error' };
    }

    // =====================================================
    // DETECT SESSION LOGOUT/ERROR
    // =====================================================
    const isSessionError =
      errorMsg.toLowerCase().includes('session') ||
      errorMsg.toLowerCase().includes('logout') ||
      errorMsg.toLowerCase().includes('not active') ||
      errorMsg.toLowerCase().includes('unavailable') ||
      errorMsg.toLowerCase().includes('authenticated') ||
      errorMsg.toLowerCase().includes('connection');

    if (isSessionError) {
      console.error(`❌ Session error detected for ${sessionName}:`, errorMsg);

      // Update session status to stopped/logged out
      try {
        await sessionRotation.markSessionUnavailable(sessionName);
      } catch (updateError: any) {
        console.warn('⚠ Failed to mark session unavailable:', updateError.message);
      }

      // =====================================================
      // CHECK RETRY COUNT (AVOID INFINITE LOOP)
      // =====================================================
      const existingMessage = await prisma.message.findFirst({
        where: { campaignId, contactId, status: 'pending' }
      });

      if (existingMessage) {
        const currentRetryCount = (existingMessage as any).retryCount || 0;
        const maxRetries = (existingMessage as any).maxRetries || 3;

        if (currentRetryCount >= maxRetries) {
          // Exceeded max retries, mark as failed
          console.error(`❌ Message exceeded max retries (${maxRetries}), marking as failed`);

          await prisma.message.updateMany({
            where: { campaignId, contactId, status: 'pending' },
            data: {
              status: 'failed',
              errorMsg: `Max retries (${maxRetries}) exceeded: ${errorMsg.substring(0, 100)}`,
            },
          });

          await safeCampaignUpdate(campaignId, { failedCount: { increment: 1 } });
          throw error;
        }

        // =====================================================
        // MARK AS WAITING (FOR RETRY WITH OTHER SESSION)
        // =====================================================
        console.log(`⏳ Marking message as 'waiting' for retry (attempt ${currentRetryCount + 1}/${maxRetries})`);

        await prisma.message.updateMany({
          where: { campaignId, contactId, status: 'pending' },
          data: {
            status: 'waiting',
            errorMsg: `Session unavailable, waiting for retry (${currentRetryCount + 1}/${maxRetries}): ${errorMsg.substring(0, 80)}`,
            retryCount: { increment: 1 },
            lastAttemptAt: new Date(),
            lastSessionId: sessionName
          } as any, // Type assertion karena field baru
        });

        // Jangan increment failedCount karena akan di-retry
        return { success: false, waiting: true, reason: 'session-unavailable' };
      }

      // Fallback jika message tidak ditemukan
      return { success: false, waiting: false, reason: 'message-not-found' };
    }

    // =====================================================
    // REAL FAILURE (non-session error)
    // =====================================================
    console.error('❌ Message sending failed:', errorMsg);

    await prisma.message.updateMany({
      where: { campaignId, contactId, status: 'pending' },
      data: {
        status: 'failed',
        errorMsg,
      },
    });

    await safeCampaignUpdate(campaignId, { failedCount: { increment: 1 } });

    throw error;
  }
}

function attachQueueHandlers(queue: Bull.Queue<CampaignJob>) {
  // One worker per queue (per session) for parallel sending across sessions,
  // while keeping sequential sending within each session.
  queue.process(1, processCampaignJob);

  queue.on('completed', async (job) => {
    const { campaignId, contactId } = job.data;

    // Emit message update event
    const message = await prisma.message.findFirst({
      where: { campaignId, contactId },
    });
    if (message) {
      emitMessageUpdate({
        campaignId,
        contactId,
        status: message.status,
        waMessageId: message.waMessageId,
        errorMsg: message.errorMsg,
      });
    }

    const pending = await prisma.message.count({
      where: { campaignId, status: 'pending' },
    });

    // Get campaign stats for real-time update
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        sentCount: true,
        failedCount: true,
        totalContacts: true,
      },
    });

    if (campaign) {
      // Emit campaign update with current stats
      emitCampaignUpdate({
        campaignId: campaign.id,
        status: campaign.status,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        totalContacts: campaign.totalContacts,
      });
    }

    if (pending === 0) {
      const failed = await prisma.message.count({
        where: { campaignId, status: 'failed' },
      });

      await safeCampaignUpdate(campaignId, {
        status: failed > 0 ? 'sent' : 'sent',
      });

      // Emit final campaign update
      const finalCampaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (finalCampaign) {
        emitCampaignUpdate({
          campaignId: finalCampaign.id,
          status: finalCampaign.status,
          sentCount: finalCampaign.sentCount,
          failedCount: finalCampaign.failedCount,
          totalContacts: finalCampaign.totalContacts,
        });
      }

      console.log(`🎉 Campaign ${campaignId} finished`);
    }
  });

  queue.on('failed', async (job, err) => {
    console.error(`❌ Job ${job.id} failed:`, err.message);

    const { campaignId, contactId } = job.data;

    // Emit message update event for failed message
    const message = await prisma.message.findFirst({
      where: { campaignId, contactId },
    });
    if (message) {
      emitMessageUpdate({
        campaignId,
        contactId,
        status: message.status,
        waMessageId: message.waMessageId,
        errorMsg: message.errorMsg,
      });
    }

    // Emit campaign update with current stats
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        status: true,
        sentCount: true,
        failedCount: true,
        totalContacts: true,
      },
    });

    if (campaign) {
      emitCampaignUpdate({
        campaignId: campaign.id,
        status: campaign.status,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        totalContacts: campaign.totalContacts,
      });
    }
  });

  queue.on('stalled', (job) => {
    console.warn(`⚠ Job ${job.id} stalled (possible WAHA/network hang)`);
  });
}

// ===============================
// GLOBAL QUEUE FACTORY (SINGLE WORKER FOR ALL SESSIONS)
// ===============================
export function getCampaignQueue(sessionName: string) {
  // ⭐ Return existing global queue if already created
  if (globalQueue) return globalQueue;

  // ⭐ Create single global queue for ALL sessions
  globalQueue = new Bull<CampaignJob>(GLOBAL_QUEUE_NAME, REDIS_URL, {
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 1, // IMPORTANT: avoid double send
      backoff: { type: 'exponential', delay: 2000 },
    },
  });

  attachQueueHandlers(globalQueue);

  console.log('✅ [QUEUE] Single global worker initialized for all sessions');

  return globalQueue;
}

// Backward compatibility: keep the original default export.
export const campaignQueue = getCampaignQueue('default');
export default campaignQueue;
