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
async function sendCampaignWithFailover(
  campaign: any,
  preferredSession: any,
  allSessions: any[]
): Promise<{ success: boolean; sessionUsed: any; error?: string }> {
  let currentSession = preferredSession;

  // Verify session is active before starting
  if (!(await isSessionActive(currentSession.sessionId))) {
    console.warn(
      `[AUTO-CAMPAIGN] Preferred session ${currentSession.sessionId} not active, finding alternative`
    );
    const nextSession = await findNextActiveSession(currentSession.sessionId, allSessions);
    if (!nextSession) {
      return {
        success: false,
        sessionUsed: currentSession,
        error: 'No active sessions available',
      };
    }
    currentSession = nextSession;
    console.log(
      `[AUTO-CAMPAIGN] Switched to session ${currentSession.sessionId} due to inactive preferred session`
    );
  }

  try {
    const variants: string[] =
      Array.isArray(campaign.variants) && campaign.variants.length > 0
        ? campaign.variants.map((m: any) => String(m ?? '').trim()).filter((m: string) => m.length > 0)
        : [String(campaign.message ?? '').trim()].filter((m: string) => m.length > 0);

    if (variants.length === 0) {
      return {
        success: false,
        sessionUsed: currentSession,
        error: 'Campaign message is empty',
      };
    }

    // Get contacts - try current session first, then fallback to any contacts
    let contacts = await prisma.contact.findMany({
      where: { sessionId: currentSession.id },
    });

    // If no contacts in current session, try to get contacts from campaign's original session
    if (contacts.length === 0 && campaign.sessionId) {
      contacts = await prisma.contact.findMany({
        where: { sessionId: campaign.sessionId },
      });
    }

    // Last resort: get any contacts
    if (contacts.length === 0) {
      contacts = await prisma.contact.findMany({
        take: 1000, // Limit to avoid too many contacts
      });
    }

    if (contacts.length === 0) {
      return {
        success: false,
        sessionUsed: currentSession,
        error: 'No contacts found',
      };
    }

    // Update campaign to use current session
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        sessionId: currentSession.id,
        status: 'sending',
        totalContacts: contacts.length,
      },
    });

    // Create message placeholder rows
    await prisma.message.createMany({
      data: contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: 'pending',
      })),
    });

    // Queue messages
    const BATCH_SIZE = 500;
    const batches = [];
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    const btns = campaign.buttons.map((b: any) => ({
      label: b.label,
      url: b.url,
    }));

    const campaignQueue = getCampaignQueue(currentSession.sessionId);

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];
        const globalIndex = b * BATCH_SIZE + i;
        const selectedMessage = variants[globalIndex % variants.length];

        await campaignQueue.add({
          campaignId: campaign.id,
          contactId: c.id,
          phoneNumber: c.phoneNumber,
          message: selectedMessage,
          imageUrl: campaign.imageUrl,
          buttons: btns,
          sessionName: currentSession.sessionId,
          messageIndex: i,
          batchIndex: b,
        });
      }
    }

    console.log(
      `[AUTO-CAMPAIGN] Campaign "${campaign.name}" queued with session ${currentSession.sessionId}`
    );

    return {
      success: true,
      sessionUsed: currentSession,
    };
  } catch (error: any) {
    console.error(`[AUTO-CAMPAIGN] Error sending campaign ${campaign.id}:`, error);

    // Try failover to next session
    const nextSession = await findNextActiveSession(currentSession.sessionId, allSessions);
    if (nextSession && nextSession.sessionId !== currentSession.sessionId) {
      console.log(
        `[AUTO-CAMPAIGN] Attempting failover from ${currentSession.sessionId} to ${nextSession.sessionId}`
      );
      return await sendCampaignWithFailover(campaign, nextSession, allSessions);
    }

    // Update campaign status to failed
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'failed' },
    });

    return {
      success: false,
      sessionUsed: currentSession,
      error: error.message || 'Failed to send campaign',
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

  // Get draft campaigns (limit to number of sessions)
  const campaigns = await getDraftCampaigns(activeSessions.length);
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
  let sessionIndex = 0;

  // Execute campaigns sequentially with delay
  for (let i = 0; i < campaigns.length; i++) {
    const campaign = campaigns[i];
    const session = activeSessions[sessionIndex % activeSessions.length];

    console.log(
      `[AUTO-CAMPAIGN] Processing campaign "${campaign.name}" with session ${session.sessionId}`
    );

    const result = await sendCampaignWithFailover(campaign, session, activeSessions);
    results.push({
      campaignId: campaign.id,
      campaignName: campaign.name,
      sessionUsed: result.sessionUsed.sessionId,
      success: result.success,
      error: result.error,
    });

    // Move to next session for next campaign
    if (result.success) {
      sessionIndex++;
    }

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
