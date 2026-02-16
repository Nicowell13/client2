// backend/src/services/auto-campaign.service.ts
import prisma from '../lib/prisma';
import wahaService from './waha.service';
import { getCampaignQueue } from './queue.service';

const MAX_SESSIONS = 10;
const DEFAULT_CAMPAIGN_DELAY_MS = 60000; // 1 minute delay between campaigns

interface AutoCampaignConfig {
  delayBetweenCampaigns?: number; // Delay in milliseconds
}

/**
 * Get active sessions (working/ready/authenticated)
 */
async function getActiveSessions() {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: 'asc' },
    take: MAX_SESSIONS,
  });

  // Refresh status from WAHA
  const activeSessions = [];
  for (const session of sessions) {
    try {
      const status = await wahaService.getSessionStatus(session.sessionId);
      const normalizedStatus = (status?.status || session.status || '').toLowerCase();

      if (['working', 'ready', 'authenticated'].includes(normalizedStatus)) {
        await prisma.session.update({
          where: { id: session.id },
          data: {
            status: status?.status || session.status,
            phoneNumber: status?.me?.id || session.phoneNumber,
          },
        });

        activeSessions.push({
          ...session,
          status: status?.status || session.status,
        });
      }
    } catch (e) {
      console.warn(`[AUTO-CAMPAIGN] Session ${session.sessionId} unreachable, skipping`);
    }
  }

  return activeSessions;
}

/**
 * Get draft campaigns ready to send
 */
async function getDraftCampaigns(limit: number = MAX_SESSIONS) {
  return await prisma.campaign.findMany({
    where: {
      status: 'draft',
    },
    include: {
      buttons: true,
      session: true,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/**
 * Check if session is still active
 */
async function isSessionActive(sessionId: string): Promise<boolean> {
  try {
    const status = await wahaService.getSessionStatus(sessionId);
    const normalizedStatus = (status?.status || '').toLowerCase();
    return ['working', 'ready', 'authenticated'].includes(normalizedStatus);
  } catch (e) {
    return false;
  }
}

/**
 * Find next available active session
 */
async function findNextActiveSession(
  currentSessionId: string,
  allSessions: any[]
): Promise<any | null> {
  const currentIndex = allSessions.findIndex((s) => s.sessionId === currentSessionId);
  if (currentIndex === -1) return null;

  // Try sessions after current one
  for (let i = currentIndex + 1; i < allSessions.length; i++) {
    if (await isSessionActive(allSessions[i].sessionId)) {
      return allSessions[i];
    }
  }

  // Try sessions before current one (wrap around)
  for (let i = 0; i < currentIndex; i++) {
    if (await isSessionActive(allSessions[i].sessionId)) {
      return allSessions[i];
    }
  }

  return null;
}

/**
 * Send campaign using specified session with failover support
 */
/**
 * Send campaign distributing messages across ALL active sessions (Round-Robin)
 */
async function sendCampaignRoundRobin(
  campaign: any,
  allSessions: any[]
): Promise<{ success: boolean; error?: string; sessionsUsed: number }> {
  try {
    if (!allSessions || allSessions.length === 0) {
      return { success: false, error: 'No active sessions available for round-robin' };
    }

    const variants: string[] =
      Array.isArray(campaign.variants) && campaign.variants.length > 0
        ? campaign.variants.map((m: any) => String(m ?? '').trim()).filter((m: string) => m.length > 0)
        : [String(campaign.message ?? '').trim()].filter((m: string) => m.length > 0);

    if (variants.length === 0) {
      return { success: false, error: 'Campaign message is empty', sessionsUsed: 0 };
    }

    // Get ALL contacts (Global pool)
    // We strictly use the global pool now, ignoring session association
    const contacts = await prisma.contact.findMany({
      take: 500, // Hard limit 500 per campaign execution as per requirement
      orderBy: { createdAt: 'desc' }
    });

    if (contacts.length === 0) {
      return { success: false, error: 'No contacts found', sessionsUsed: 0 };
    }

    console.log(`[AUTO-CAMPAIGN] Distributing ${contacts.length} contacts across ${allSessions.length} sessions`);

    // Update campaign status
    try {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: 'sending',
          totalContacts: contacts.length,
          sessionId: 'MULTI-SESSION', // Marker for multi-session campaign
        },
      });
    } catch (dbError: any) {
      if (dbError.code === 'P2025') {
        return { success: false, error: 'Campaign not found (deleted)', sessionsUsed: 0 };
      }
      throw dbError;
    }

    // Create message placeholder rows
    await prisma.message.createMany({
      data: contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: 'pending',
      })),
    });

    const btns = campaign.buttons.map((b: any) => ({
      label: b.label,
      url: b.url,
    }));

    // Round-Robin Distribution Loop
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];

      // Pick session based on index (Round Robin)
      const sessionIndex = i % allSessions.length;
      const currentSession = allSessions[sessionIndex];

      const selectedMessage = variants[i % variants.length];
      const campaignQueue = getCampaignQueue(currentSession.sessionId);

      try {
        await campaignQueue.add({
          campaignId: campaign.id,
          contactId: c.id,
          phoneNumber: c.phoneNumber,
          message: selectedMessage,
          imageUrl: campaign.imageUrl,
          buttons: btns,
          sessionName: currentSession.sessionId,
          messageIndex: i,
          batchIndex: 0,
        }, {
          jobId: `${campaign.id}_${c.id}`, // Unique job ID
          removeOnComplete: 100,
          removeOnFail: 50,
        });
      } catch (queueError: any) {
        console.error(`[AUTO-CAMPAIGN] Failed to add job to queue for session ${currentSession.sessionId}:`, queueError.message);
      }
    }

    console.log(
      `[AUTO-CAMPAIGN] Campaign "${campaign.name}" distributed across ${allSessions.length} sessions`
    );

    return {
      success: true,
      sessionsUsed: allSessions.length,
    };
  } catch (error: any) {
    console.error(`[AUTO-CAMPAIGN] Error sending campaign ${campaign.id}:`, error);

    // Update to failed if possible
    try {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'failed' },
      });
    } catch (e) { }

    return {
      success: false,
      error: error.message || 'Failed to send campaign',
      sessionsUsed: 0
    };
  }
}

/**
 * Execute campaigns automatically with session rotation
 */
export async function executeAutoCampaigns(config: AutoCampaignConfig = {}) {
  const delayBetweenCampaigns = config.delayBetweenCampaigns || DEFAULT_CAMPAIGN_DELAY_MS;

  console.log('[AUTO-CAMPAIGN] Starting auto-execution...');

  // Get active sessions
  const activeSessions = await getActiveSessions();
  if (activeSessions.length === 0) {
    console.warn('[AUTO-CAMPAIGN] No active sessions found');
    return {
      success: false,
      message: 'No active sessions available',
      campaignsProcessed: 0,
    };
  }

  console.log(`[AUTO-CAMPAIGN] Found ${activeSessions.length} active sessions`);

  // Get draft campaigns (Process 1 by 1 for simplicity of distribution)
  const campaigns = await getDraftCampaigns(1); // Process 1 at a time
  if (campaigns.length === 0) {
    console.log('[AUTO-CAMPAIGN] No draft campaigns found');
    return {
      success: true,
      message: 'No draft campaigns to execute',
      campaignsProcessed: 0,
    };
  }

  console.log(`[AUTO-CAMPAIGN] Found ${campaigns.length} draft campaigns`);

  const results = [];

  // Execute campaigns
  for (let i = 0; i < campaigns.length; i++) {
    const campaign = campaigns[i];

    console.log(
      `[AUTO-CAMPAIGN] Processing campaign "${campaign.name}"`
    );

    const result = await sendCampaignRoundRobin(campaign, activeSessions);
    results.push({
      campaignId: campaign.id,
      campaignName: campaign.name,
      success: result.success,
      error: result.error,
    });

    // Delay before next campaign (except for last one)
    if (i < campaigns.length - 1) {
      console.log(`[AUTO-CAMPAIGN] Waiting ${delayBetweenCampaigns}ms before next campaign...`);
      await new Promise((resolve) => setTimeout(resolve, delayBetweenCampaigns));
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;

  console.log(
    `[AUTO-CAMPAIGN] Completed: ${successCount} successful, ${failedCount} failed`
  );

  return {
    success: true,
    message: `Processed ${campaigns.length} campaigns`,
    campaignsProcessed: campaigns.length,
    results,
  };
}
