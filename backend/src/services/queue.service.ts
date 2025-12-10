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
    attempts: 1, // Only 1 attempt to avoid double-send
    backoff: undefined as any,
  },
});

/* ============================================================
   JOB PAYLOAD TYPES
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
   UTILS: DELAY + SAFE SEND
============================================================ */
function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calcMessageDelay(index: number): number {
  const base = random(7000, 12000);
  const extra = Math.floor(index / 5) * random(8000, 15000);
  return base + extra;
}

function batchCooldown(batchIndex: number) {
  return batchIndex === 0 ? 0 : random(20000, 30000);
}

/**
 * 🔥 FIX UTAMA:
 * Normalisasi WAHA messageId agar Prisma menerima STRING, bukan OBJECT
 */
function extractWAId(result: any): string | null {
  if (!result) return null;

  // WEBJS & NOWEB: id object
  if (result.id && typeof result.id === "object") {
    if (result.id._serialized) return result.id._serialized;
    if (result.id.id) return String(result.id.id);
  }

  // Pure string id
  if (typeof result.id === "string") return result.id;

  // Other engines
  if (result.key?.id) return result.key.id;
  if (result.messageId) return result.messageId;

  return null;
}

/**
 * Auto retry inside WAHA request
 */
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
    /* --------------------------------------------------
       RANDOM MESSAGE (ANTI-SPAM)
    -------------------------------------------------- */
    const messageToSend = messages[Math.floor(Math.random() * messages.length)];

    /* --------------------------------------------------
       BATCH + NATURAL DELAY
    -------------------------------------------------- */
    if (messageIndex === 0) {
      const cooldown = batchCooldown(batchIndex);
      console.log(`🧊 Batch ${batchIndex} cooldown ${cooldown}ms`);
      await new Promise(r => setTimeout(r, cooldown));
    }

    const delay = calcMessageDelay(messageIndex);
    console.log(`⏳ Delay ${delay}ms before sending message ${messageIndex}`);
    await new Promise(r => setTimeout(r, delay));

    /* --------------------------------------------------
       BUILD FINAL MESSAGE: TEXT + URL BUTTONS
       (WEBJS cannot send interactive URL buttons)
    -------------------------------------------------- */
    let text = messageToSend;

    if (Array.isArray(buttons) && buttons.length > 0) {
      const buttonsText = buttons
        .map((b, i) => `${i + 1}. ${b.label}\n${b.url}`)
        .join("\n\n");

      text = `${text}\n\n${buttonsText}`;
    }

    /* --------------------------------------------------
       SEND MESSAGE TO WAHA
    -------------------------------------------------- */
    const result = await safeSendMessage(async () => {
      if (imageUrl) {
        return wahaService.sendImageMessage(sessionName, phoneNumber, imageUrl, text);
      }
      return wahaService.sendTextMessage(sessionName, phoneNumber, text);
    });

    const waId = extractWAId(result);

    /* --------------------------------------------------
       UPDATE → SENT
    -------------------------------------------------- */
    await prisma.message.updateMany({
      where: { campaignId, contactId, status: "pending" },
      data: {
        status: "sent",
        waMessageId: waId,
        sentAt: new Date(),
      },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: 1 } },
    });

    return { success: true, messageId: waId };
  } catch (error: any) {
    console.error("❌ Message sending failed:", error.message);

    await prisma.message.updateMany({
      where: { campaignId, contactId, status: "pending" },
      data: {
        status: "failed",
        errorMsg: error.message || "Unknown error",
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
campaignQueue.on("completed", async (job) => {
  const { campaignId } = job.data;

  const pending = await prisma.message.count({
    where: { campaignId, status: "pending" },
  });

  if (pending === 0) {
    const total = await prisma.message.count({ where: { campaignId } });
    const failed = await prisma.message.count({
      where: { campaignId, status: "failed" },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: failed === total ? "failed" : "sent" },
    });

    console.log(`🎉 Campaign ${campaignId} complete`);
  }
});

campaignQueue.on("failed", async (job, err) => {
  const { campaignId } = job.data;

  console.error(`❌ Job ${job.id} failed: ${err.message}`);

  const pending = await prisma.message.count({
    where: { campaignId, status: "pending" },
  });

  if (pending === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "failed" },
    });
  }
});

export default campaignQueue;
