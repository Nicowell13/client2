// backend/src/services/queue.service.ts

import Bull from 'bull';
import prisma from '../lib/prisma';
import wahaService from './waha.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/* ============================================================
   QUEUE INITIALIZATION
============================================================ */
export const campaignQueue = new Bull('campaign-messages', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    // Reduce to single attempt to avoid duplicate sends/spam if WAHA already succeeded
    attempts: 1,
    // No backoff needed when avoiding retries
    backoff: undefined as any,
  },
});

/* ============================================================
   JOB PAYLOAD
============================================================ */
interface CampaignJob {
  campaignId: string;
  contactId: string;
  phoneNumber: string;
  messages: string[];
  imageUrl: string | null;
  buttons: Array<{ label: string; url: string }>;
  sessionName: string;
  messageIndex: number;
  batchIndex: number;
}

/* ============================================================
   UTILS: RANDOM DELAY + SAFE SEND (AUTO RETRY)
============================================================ */
function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Human-like delay: 7–12 seconds + extra delay every 5 messages
function calcMessageDelay(index: number): number {
  const base = random(7000, 12000);
  const extra = Math.floor(index / 5) * random(8000, 15000);
  return base + extra;
}

// Batch cooldown to reduce spam detection
function batchCooldown(batchIndex: number): number {
  return batchIndex === 0 ? 0 : random(20000, 30000);
}

// Auto retry WAHA inside job, not just Bull attempts
async function safeSendMessage(fn: () => Promise<any>, retries = 1) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      console.warn(`⚠ WAHA retry ${i + 1}/${retries} failed: ${err.message}`);
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  throw lastError;
}

/* ============================================================
   QUEUE WORKER
============================================================ */
campaignQueue.process(1, async (job: Bull.Job<CampaignJob>) => {
  const {
    campaignId,
    contactId,
    phoneNumber,
    messages,
    imageUrl,
    buttons,
    sessionName,
    messageIndex,
    batchIndex,
  } = job.data;

  try {
    /* -----------------------------------------
       RANDOM MESSAGE SELECTION (ANTI-SPAM)
    ----------------------------------------- */
    const messageToSend = messages[Math.floor(Math.random() * messages.length)];

    /* -----------------------------------------
       BATCH COOLDOWN (first message only)
    ----------------------------------------- */
    if (messageIndex === 0) {
      const cooldown = batchCooldown(batchIndex);
      console.log(
        `🧊 Batch ${batchIndex} cooldown ${cooldown}ms for campaign ${campaignId}`
      );
      await new Promise(r => setTimeout(r, cooldown));
    }

    /* -----------------------------------------
       NATURAL DELAY PER MESSAGE
    ----------------------------------------- */
    const delay = calcMessageDelay(messageIndex);
    console.log(
      `⏳ Delay message ${messageIndex + 1} in batch ${batchIndex} by ${delay}ms`
    );
    await new Promise(r => setTimeout(r, delay));

    // Compose final text: append buttons as text links, not interactive buttons
    let text = messageToSend;
    if (Array.isArray(buttons) && buttons.length > 0) {
      const buttonsText = buttons
        .map((b: any, idx: number) => `${idx + 1}. ${b.label}\n${b.url}`)
        .join("\n\n");
      text = `${text}\n\n${buttonsText}`;
    }

    // Send and capture WA message id
    const result = await safeSendMessage(async () => {
      if (imageUrl) {
        return wahaService.sendImageMessage(sessionName, phoneNumber, imageUrl, text);
      }
      return wahaService.sendTextMessage(sessionName, phoneNumber, text);
    });

    /* -----------------------------------------
       UPDATE MESSAGE → SENT
    ----------------------------------------- */
    await prisma.message.updateMany({
      where: { campaignId, contactId, status: 'pending' },
      data: {
        status: 'sent',
        waMessageId: (result && (result.id || result.key?.id || result.messageId)) || null,
        sentAt: new Date(),
      },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: 1 } },
    });

    return { success: true, messageId: (result && (result.id || result.key?.id || result.messageId)) || null };
  } catch (error: any) {
    console.error('❌ Message sending failed:', error.message);

    /* -----------------------------------------
       UPDATE FAILED MESSAGE
    ----------------------------------------- */
    await prisma.message.updateMany({
      where: { campaignId, contactId, status: 'pending' },
      data: {
        status: 'failed',
        errorMsg: error.message || 'Unknown error',
      },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { failedCount: { increment: 1 } },
    });

    throw error;
  }
});

/* ============================================================
   QUEUE EVENT LISTENERS
============================================================ */
campaignQueue.on('completed', async (job) => {
  const { campaignId } = job.data;

  const pending = await prisma.message.count({
    where: { campaignId, status: 'pending' },
  });

  if (pending === 0) {
    const total = await prisma.message.count({ where: { campaignId } });
    const failed = await prisma.message.count({
      where: { campaignId, status: 'failed' },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: failed === total ? 'failed' : 'sent',
      },
    });

    console.log(`🎉 Campaign ${campaignId} finished! Status updated.`);
  }
});

campaignQueue.on('failed', async (job, err) => {
  const { campaignId } = job.data;
  console.error(`❌ Job ${job.id} failed: ${err.message}`);

  const pending = await prisma.message.count({
    where: { campaignId, status: 'pending' },
  });

  if (pending === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'failed' },
    });
  }
});

export default campaignQueue;
