import Bull from 'bull';
import prisma from '../lib/prisma';
import wahaService from './waha.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const DEFAULT_QUEUE_NAME = 'campaign-messages';
const sessionQueues = new Map<string, Bull.Queue<CampaignJob>>();

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
  const normalized = normalizeSessionName(sessionName);
  if (normalized === 'default') return DEFAULT_QUEUE_NAME;
  return `${DEFAULT_QUEUE_NAME}:${sanitizeQueueSegment(normalized)}`;
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

    return { success: true, messageId: waMessageId };
  } catch (error: any) {
    const errorMsg = String(error?.message || '');

    // =====================================================
    // 🔥 WEBJS NON-FATAL ERROR HANDLING (IMPORTANT FIX)
    // =====================================================
    const isWebJSNonFatal =
      errorMsg.includes('addAnnotations') ||
      errorMsg.includes('processMedia') ||
      errorMsg.includes('Cannot read properties');

    if (isWebJSNonFatal) {
      console.warn('⚠ WebJS non-fatal error, marking message as SENT');

      await prisma.message.updateMany({
        where: { campaignId, contactId, status: 'pending' },
        data: {
          status: 'sent',
          sentAt: new Date(),
          errorMsg: 'WebJS warning (message delivered)',
        },
      });

      await safeCampaignUpdate(campaignId, { sentCount: { increment: 1 } });

      return { success: true, warning: 'webjs-non-fatal' };
    }

    // =====================================================
    // REAL FAILURE
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
// QUEUE FACTORY (ONE QUEUE/WORKER PER SESSION)
// ===============================
export function getCampaignQueue(sessionName: string) {
  const normalized = normalizeSessionName(sessionName);
  const existing = sessionQueues.get(normalized);
  if (existing) return existing;

  const queueName = buildQueueName(normalized);
  const queue = new Bull<CampaignJob>(queueName, REDIS_URL, {
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 1, // IMPORTANT: avoid double send
      backoff: { type: 'exponential', delay: 2000 },
    },
  });

  attachQueueHandlers(queue);
  sessionQueues.set(normalized, queue);
  return queue;
}

// Backward compatibility: keep the original default export.
export const campaignQueue = getCampaignQueue('default');
export default campaignQueue;
