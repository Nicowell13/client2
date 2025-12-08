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
    attempts: 3,
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
//  DELAY SYSTEM (VERY IMPORTANT FOR WHATSAPP SAFETY)
// ========================================================
function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Delay per message
function calcMessageDelay(index: number): number {
  const perMessage = random(7000, 12000); // 7–12 sec natural delay
  const extra = Math.floor(index / 5) * random(8000, 15000); // extra delay every 5 msgs
  return perMessage + extra;
}

// Delay per batch (max 500)
function batchCooldown(batchIndex: number): number {
  return batchIndex === 0 ? 0 : random(20000, 30000); // 20–30 sec cooldown
}

// ========================================================
//  QUEUE PROCESSOR (5 concurrent workers)
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
    // Apply Batch Delay (only first message in each batch triggers cooldown)
    if (messageIndex === 0) {
      const cooldown = batchCooldown(batchIndex);
      console.log(
        `🧊 Batch ${batchIndex} cooldown ${cooldown}ms for campaign ${campaignId}`
      );
      await new Promise((r) => setTimeout(r, cooldown));
    }

    // Delay per message
    const delay = calcMessageDelay(messageIndex);
    console.log(
      `⏳ Delaying message ${messageIndex + 1} in batch ${batchIndex} by ${delay}ms`
    );
    await new Promise((r) => setTimeout(r, delay));

    // Send WhatsApp message
    const result = await wahaService.sendMessageWithButtons(
      sessionName,
      phoneNumber,
      message,
      imageUrl,
      buttons
    );

    // Update message status
    await prisma.message.updateMany({
      where: { campaignId, contactId, status: 'pending' },
      data: {
        status: 'sent',
        waMessageId: result?.id || null,
        sentAt: new Date(),
      },
    });

    // Increment sent count
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { sentCount: { increment: 1 } },
    });

    return { success: true, messageId: result?.id };
  } catch (error: any) {
    console.error('❌ Message sending failed:', error?.message);

    // Mark failed message
    await prisma.message.updateMany({
      where: { campaignId, contactId, status: 'pending' },
      data: {
        status: 'failed',
        errorMsg: error?.message || 'Unknown error',
      },
    });

    // Increment failed count
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { failedCount: { increment: 1 } },
    });

    throw error;
  }
});

// ========================================================
// QUEUE EVENT LISTENERS
// ========================================================
campaignQueue.on('completed', async (job, result) => {
  console.log(`✔ Job ${job.id} completed`, result);

  const { campaignId } = job.data;

  // Check if campaign is finished
  const pending = await prisma.message.count({
    where: { campaignId, status: 'pending' },
  });

  if (pending === 0) {
    console.log(`🎉 Campaign ${campaignId} fully processed!`);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'sent' },
    });
  }
});

campaignQueue.on('failed', async (job, err) => {
  const campaignId = job.data.campaignId;
  console.error(`❌ Job ${job.id} failed:`, err.message);

  // If all messages processed, update campaign
  const pending = await prisma.message.count({
    where: { campaignId, status: 'pending' },
  });

  if (pending === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'sent' },
    });
  }
});

export default campaignQueue;
