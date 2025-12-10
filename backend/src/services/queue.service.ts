// backend/src/services/queue.service.ts

import Bull from "bull";
import prisma from "../lib/prisma";
import wahaService from "./waha.service";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

/* ============================================================
   INIT QUEUE
============================================================ */
export const campaignQueue = new Bull("campaign-messages", REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 1, // WAHA should not retry twice
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
   UTILS: DELAY + NORMALIZE ID
============================================================ */
function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calcMessageDelay(idx: number): number {
  const base = random(5000, 9000);
  const extra = Math.floor(idx / 5) * random(7000, 12000);
  return base + extra;
}

function batchCooldown(batchIndex: number) {
  return batchIndex === 0 ? 0 : random(15000, 25000);
}

// Extract WebJS / WAHA messageId safely
function extractWAId(result: any): string | null {
  if (!result) return null;

  if (result.id && typeof result.id === "string") return result.id;
  if (result.id?._serialized) return result.id._serialized;
  if (result.key?.id) return result.key.id;
  if (result.messageId) return result.messageId;

  return null;
}

async function safeSendMessage(fn: () => Promise<any>, retries = 1) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      console.warn(`⚠ WAHA retry ${i + 1}/${retries} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500));
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
    /* -------------------------------
       PICK RANDOM MESSAGE VARIANT
    ------------------------------- */
    const messageToSend =
      messages[Math.floor(Math.random() * messages.length)];

    /* -------------------------------
       BATCH COOLDOWN
    ------------------------------- */
    if (messageIndex === 0) {
      const cooldown = batchCooldown(batchIndex);
      console.log(`🧊 Batch ${batchIndex} cooldown ${cooldown}ms`);
      await new Promise((r) => setTimeout(r, cooldown));
    }

    /* -------------------------------
       NATURAL HUMAN DELAY
    ------------------------------- */
    const delay = calcMessageDelay(messageIndex);
    console.log(`⏳ Delay ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));

    /* -------------------------------
       PREPARE WAHA BUTTON TEMPLATE PAYLOAD
    ------------------------------- */

    const wahaButtons = buttons.map((b) => ({
      type: "url",
      text: b.label,
      url: b.url,
    }));

    const header = "Cuandaging123";
    const footer = "Klik tombol di bawah";

    const headerImage =
      imageUrl
        ? {
            mimetype: "image/jpeg",
            filename: "header.jpg",
            url: imageUrl,
          }
        : undefined;

    /* -------------------------------
       SEND TO WAHA
    ------------------------------- */
    const result = await safeSendMessage(() =>
      wahaService.sendButtonTemplate({
        session: sessionName,
        phoneNumber,
        header,
        headerImage,
        body: messageToSend,
        footer,
        buttons: wahaButtons,
      })
    );

    const waId = extractWAId(result);

    /* -------------------------------
       UPDATE SENT STATUS
    ------------------------------- */
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

    console.log("✅ SENT →", waId);
    return { success: true, messageId: waId };
  } catch (err: any) {
    console.error("❌ Failed:", err.message);

    await prisma.message.updateMany({
      where: { campaignId, contactId, status: "pending" },
      data: {
        status: "failed",
        errorMsg: err.message,
      },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { failedCount: { increment: 1 } },
    });

    throw err;
  }
});

/* ============================================================
   QUEUE EVENTS
============================================================ */
campaignQueue.on("completed", async (job) => {
  const { campaignId } = job.data;

  const pending = await prisma.message.count({
    where: { campaignId, status: "pending" },
  });

  if (pending === 0) {
    const failed = await prisma.message.count({
      where: { campaignId, status: "failed" },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: failed > 0 ? "failed" : "sent" },
    });

    console.log(`🎉 Campaign ${campaignId} DONE`);
  }
});

campaignQueue.on("failed", async (job, err) => {
  console.error(`❌ Job ${job.id} failed: ${err.message}`);
});

export default campaignQueue;
