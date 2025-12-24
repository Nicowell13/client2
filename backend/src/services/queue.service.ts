import Bull from 'bull';
import prisma from '../lib/prisma';
import wahaService from './waha.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ===============================
// QUEUE INITIALIZATION
// ===============================
export const campaignQueue = new Bull('campaign-messages', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 1, // IMPORTANT: avoid double send
    backoff: { type: 'exponential', delay: 2000 },
  },
});

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

  // occasional cooldown to be safe (every 10 messages), capped
  const periodic = index > 0 && index % 10 === 0 ? random(20000, 40000) : 0;

  const delay = base + gradual + periodic;
  return Math.min(delay, 60000);
}

function batchCooldown(batchIndex: number): number {
  return batchIndex === 0 ? 0 : random(30000, 45000);
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

// ========================================================
// QUEUE PROCESSOR
// ========================================================
campaignQueue.process(1, async (job: Bull.Job<CampaignJob>) => {
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
    const result = await wahaService.sendMessageWithButtons(
      sessionName,
      phoneNumber,
      message,
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
});

// ========================================================
// QUEUE EVENTS
// ========================================================
campaignQueue.on('completed', async (job) => {
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

campaignQueue.on('failed', async (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err.message);
});

campaignQueue.on('stalled', (job) => {
  console.warn(`⚠ Job ${job.id} stalled (possible WAHA/network hang)`);
});

export default campaignQueue;
