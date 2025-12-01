import Bull from 'bull';
import prisma from '../lib/prisma';
import wahaService from './waha.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create queue
export const campaignQueue = new Bull('campaign-messages', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Job interface
interface CampaignJob {
  campaignId: string;
  contactId: string;
  phoneNumber: string;
  message: string;
  imageUrl: string | null;
  buttons: Array<{ label: string; url: string }>;
  sessionName: string;
  messageIndex: number; // Track message position for delay calculation
}

// Delay helper function
function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Calculate delay based on message index
function calculateDelay(messageIndex: number): number {
  const baseDelay = getRandomDelay(7000, 9000); // 7-9 seconds between messages
  const batchDelay = Math.floor(messageIndex / 10) * getRandomDelay(10000, 15000); // 10-15 seconds per 10 messages
  return baseDelay + batchDelay;
}

// Track message count per campaign
const campaignMessageCount = new Map<string, number>();

// Process messages with concurrency limit
campaignQueue.process(5, async (job: Bull.Job<CampaignJob>) => {
  const { campaignId, contactId, phoneNumber, message, imageUrl, buttons, sessionName, messageIndex } =
    job.data;

  try {
    // Apply delay based on message index
    const delay = calculateDelay(messageIndex);
    console.log(`Delaying message ${messageIndex + 1} for campaign ${campaignId} by ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Send message via WAHA
    const result = await wahaService.sendMessageWithButtons(
      sessionName,
      phoneNumber,
      message,
      imageUrl,
      buttons
    );

    // Update message status
    await prisma.message.updateMany({
      where: {
        campaignId,
        contactId,
        status: 'pending',
      },
      data: {
        status: 'sent',
        waMessageId: result.id || null,
        sentAt: new Date(),
      },
    });

    // Update campaign sent count
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        sentCount: {
          increment: 1,
        },
      },
    });

    return { success: true, messageId: result.id };
  } catch (error: any) {
    // Update message as failed
    await prisma.message.updateMany({
      where: {
        campaignId,
        contactId,
        status: 'pending',
      },
      data: {
        status: 'failed',
        errorMsg: error.message,
      },
    });

    // Update campaign failed count
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        failedCount: {
          increment: 1,
        },
      },
    });

    throw error;
  }
});

// Queue event listeners
campaignQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed successfully:`, result);
});

campaignQueue.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

export default campaignQueue;
