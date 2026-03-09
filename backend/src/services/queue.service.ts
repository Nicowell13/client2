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
const MESSAGE_DELAY_MIN_MS = Number(process.env.MESSAGE_DELAY_MIN_MS || 0);
const MESSAGE_DELAY_MAX_MS = Number(process.env.MESSAGE_DELAY_MAX_MS || 0);
const TYPING_INDICATOR_ENABLED = false; // Disabled for bulk send max speed
const READ_RECEIPT_ENABLED = false; // Disabled for bulk send max speed

function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get time-based delay multiplier
 * Pagi lebih lambat, siang normal, malam sedikit lebih lambat
 */
//function getTimeMultiplier(): number {
//const hour = new Date().getHours();

//if (hour >= 10 && hour < 12) return 1.3;  // Pagi: lebih lambat
//if (hour >= 12 && hour < 18) return 1.0;  // Siang: normal
//if (hour >= 18 && hour < 20) return 1.1;  // Sore: sedikit lambat
//if (hour >= 20 && hour < 22) return 1.2;  // Malam: lebih lambat

//return 1.5; // Di luar jam kerja: sangat lambat (jika masih berjalan)
//}

function calcMessageDelay(index: number): number {
  return 0; // User request: ubah delay antar pesan menjadi nol
}

function batchCooldown(batchIndex: number): number {
  return 0; // No cooldown between batches
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
  // User request: No delay, simultaneous sending. Disabling global send concurrency locks.
  return;
}

async function releaseGlobalSendSlot() {
  // User request: No delay, simultaneous sending. Disabling global send concurrency locks.
  return;
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
    // ⭐ DEDUPLICATION: SKIP IF ALREADY SENT
    // ------------------------------------
    const messageRecord = await prisma.message.findFirst({
      where: { campaignId, contactId },
      select: { id: true, status: true, waMessageId: true }
    });

    if (messageRecord?.status === 'sent' && messageRecord?.waMessageId) {
      return { success: true, skipped: true, reason: 'already-sent' };
    }

    if (!messageRecord) {
      return { success: false, skipped: true, reason: 'message-missing' };
    }

    // ------------------------------------
    // SEND MESSAGE IMMEDIATELY (NO DELAY, NO CHECKS)
    // User request: Meta Business Suite, simultaneous burst sending
    // ------------------------------------
    let activeSessionName = sessionName;
    let result: any;

    // Get contact info for template replacement
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, name: true, phoneNumber: true }
    });

    if (!contact) {
      throw new Error(`Contact ${contactId} not found`);
    }

    // Process message with content variation
    const finalMessage = contentVariation.processMessageTemplate(message, contact);

    // SEND THE MESSAGE (direct, no rate limiting, no presence, no typing)
    result = await wahaService.sendMessageWithButtons(
      activeSessionName,
      phoneNumber,
      finalMessage,
      imageUrl,
      buttons
    );

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

    return { success: true, messageId: waMessageId };
  } catch (error: any) {
    const errorMsg = String(error?.message || '');

    // =====================================================
    // 🔥 NON-FATAL ERROR HANDLING
    // =====================================================
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
    // DETECT MEDIA/CONTENT ERRORS (PERMANENT FAIL)
    // =====================================================
    const isMediaError =
      errorMsg.includes('404') ||
      errorMsg.includes('400') ||
      errorMsg.includes('415') ||
      errorMsg.toLowerCase().includes('err_bad_request') ||
      errorMsg.toLowerCase().includes('failed to send image') ||
      errorMsg.toLowerCase().includes('failed to send video');

    if (isMediaError) {
      console.error(`❌ Media/Content error (permanent fail):`, errorMsg);

      await prisma.message.updateMany({
        where: { campaignId, contactId, status: 'pending' },
        data: {
          status: 'failed',
          errorMsg: `Media Error: ${errorMsg.substring(0, 150)}`,
        },
      });

      await safeCampaignUpdate(campaignId, { failedCount: { increment: 1 } });
      throw new Error(`Media Error: ${errorMsg}`); // Stop processing this job
    }

    // =====================================================
    // DETECT SESSION LOGOUT/ERROR
    // =====================================================
    // Only treat as session error if it's NOT a media error
    const isSessionError =
      (errorMsg.toLowerCase().includes('session') ||
        errorMsg.toLowerCase().includes('logout') ||
        errorMsg.toLowerCase().includes('not active') ||
        errorMsg.toLowerCase().includes('unavailable') ||
        errorMsg.toLowerCase().includes('authenticated') ||
        errorMsg.toLowerCase().includes('connection')) &&
      !isMediaError;

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
        // TRY IMMEDIATE FAILOVER RETRY INSTEAD OF WAITING
        // =====================================================
        console.log(`⏳ Attempting failover for message (attempt ${currentRetryCount + 1}/${maxRetries})`);

        const failoverSession = await sessionRotation.getFailoverSession(sessionName, messageIndex);

        if (failoverSession) {
          console.log(`✅ Failover found: ${failoverSession.sessionId}. Re-queueing job.`);
          
          await prisma.message.updateMany({
            where: { campaignId, contactId, status: 'pending' },
            data: {
              retryCount: { increment: 1 },
              lastAttemptAt: new Date(),
              lastSessionId: sessionName
            } as any,
          });

          // Re-add to queue back with new session
          const campaignQueue = getCampaignQueue('global');
          await campaignQueue.add({
            ...job.data,
            sessionName: failoverSession.sessionId
          }, {
            delay: 1000,
            jobId: `${campaignId}_${contactId}_retry_${currentRetryCount}`
          });

          return { success: false, waiting: false, retry: true, reason: 'session-failover' };
        } else {
          // No failover found, put to waiting
          console.log(`⏳ No failover session available. Marking message as 'waiting'`);
          await prisma.message.updateMany({
            where: { campaignId, contactId, status: 'pending' },
            data: {
              status: 'waiting',
              errorMsg: `Session unavailable, no failover. Waiting. (${currentRetryCount + 1}/${maxRetries}): ${errorMsg.substring(0, 80)}`,
              retryCount: { increment: 1 },
              lastAttemptAt: new Date(),
              lastSessionId: sessionName
            } as any,
          });
          return { success: false, waiting: true, reason: 'session-unavailable-no-failover' };
        }
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
  // WAHA (NOWEB Baileys) crashed and returned HTTP 422 (Session FAILED) when hit with 60 simultaneous requests.
  // This means the internal WhatsApp engine cannot handle that spike.
  // 25 is a very safe but high-speed upper limit for stable bulk sending on a 2GB VPS without crashing WAHA.
  queue.process(25, processCampaignJob);

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
    // Fix for MaxRetriesPerRequestError
    redis: {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    },
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
