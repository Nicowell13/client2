import Bull from 'bull';
import prisma from '../lib/prisma';
import wahaService from './waha.service';
import sessionRotation from './session-rotation.service';

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
// DELAY SYSTEM (WHATSAPP SAFE)
// ========================================================
function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calcMessageDelay(index: number): number {
  // NOTE: previously this used step-based growth (every 5 messages) which can
  // create multi-minute pauses around index ~20+ and looks like the system is stuck.
  // Keep WhatsApp-safe jitter but cap delay to avoid long silent gaps.
  const base = random(12000, 20000);

  // gradual backoff: grows slowly with index, capped
  const gradual = Math.min(index * random(250, 600), 15000);

  // occasional cooldown to be safe (every 5 messages), capped
  const periodic = index > 0 && index % 5 === 0 ? random(20000, 40000) : 0;

  const delay = base + gradual + periodic;
  return Math.min(delay, 60000);
}

function batchCooldown(batchIndex: number): number {
  return batchIndex === 0 ? 0 : random(30000, 45000);
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
    console.log(`⏳ Delay ${delay}ms before send`);
    await new Promise((r) => setTimeout(r, delay));

    // ------------------------------------
    // CHECK SESSION STATUS BEFORE SENDING
    // ------------------------------------
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

        throw new Error(`Session ${sessionName} is not active. Status: ${normalizedStatus}`);
      }
    } catch (statusError: any) {
      // If status check fails, session might be logged out
      console.warn(`⚠ Session ${sessionName} status check failed:`, statusError.message);
      throw new Error(`Session ${sessionName} unavailable or logged out`);
    }

    // ------------------------------------
    // SEND MESSAGE
    // ------------------------------------
    await acquireGlobalSendSlot();
    let result: any;
    try {
      result = await wahaService.sendMessageWithButtons(
        sessionName,
        phoneNumber,
        message,
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
      const limitReached = await sessionRotation.incrementJobCount(sessionName);
      if (limitReached) {
        console.log(`🛑 Session ${sessionName} reached job limit, will rest`);
      }
    } catch (jobCountError: any) {
      console.warn(`⚠ Failed to increment job count:`, jobCountError.message);
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
      // MARK AS WAITING (FOR RETRY WITH OTHER SESSION)
      // =====================================================
      // Jika error karena session logout/suspend, jangan mark sebagai failed
      // tapi sebagai 'waiting' supaya bisa di-retry dengan session lain
      console.log(`⏳ Marking message as 'waiting' for retry with another session`);

      await prisma.message.updateMany({
        where: { campaignId, contactId, status: 'pending' },
        data: {
          status: 'waiting',
          errorMsg: `Session unavailable, waiting for retry: ${errorMsg.substring(0, 100)}`,
        },
      });

      // Jangan increment failedCount karena akan di-retry
      return { success: false, waiting: true, reason: 'session-unavailable' };
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
    const { campaignId } = job.data;

    const pending = await prisma.message.count({
      where: { campaignId, status: 'pending' },
    });

    if (pending === 0) {
      const failed = await prisma.message.count({
        where: { campaignId, status: 'failed' },
      });

      await safeCampaignUpdate(campaignId, {
        status: failed > 0 ? 'sent' : 'sent',
      });

      console.log(`🎉 Campaign ${campaignId} finished`);
    }
  });

  queue.on('failed', async (job, err) => {
    console.error(`❌ Job ${job.id} failed:`, err.message);
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
