// backend/src/services/campaign-recovery.service.ts
import prisma from '../lib/prisma';
import wahaService from './waha.service';
import { getCampaignQueue } from './queue.service';

/**
 * Campaign Recovery Service
 * 
 * This service handles automatic recovery of campaigns when sessions fail or logout.
 * It will:
 * 1. Detect campaigns with "sending" status but inactive sessions
 * 2. Find pending messages that haven't been sent
 * 3. Reassign those messages to active sessions
 * 4. Re-queue the messages for sending
 */

interface RecoveryResult {
    success: boolean;
    campaignsRecovered: number;
    messagesReassigned: number;
    details: Array<{
        campaignId: string;
        campaignName: string;
        oldSession: string;
        newSession: string;
        pendingMessages: number;
    }>;
}

/**
 * Check if a session is active
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
 * Get all active sessions from database
 */
async function getActiveSessions() {
    const sessions = await prisma.session.findMany({
        orderBy: { createdAt: 'asc' },
    });

    const activeSessions = [];
    for (const session of sessions) {
        if (await isSessionActive(session.sessionId)) {
            // Update session status in DB
            await prisma.session.update({
                where: { id: session.id },
                data: { status: 'working' },
            });
            activeSessions.push(session);
        } else {
            // Mark as stopped
            await prisma.session.update({
                where: { id: session.id },
                data: { status: 'stopped' },
            });
        }
    }

    return activeSessions;
}

/**
 * Get campaigns that are stuck in "sending" status with inactive sessions
 */
async function getStuckCampaigns() {
    const campaigns = await prisma.campaign.findMany({
        where: {
            status: 'sending',
        },
        include: {
            session: true,
            buttons: true,
        },
    });

    const stuckCampaigns = [];
    for (const campaign of campaigns) {
        const isActive = await isSessionActive(campaign.session.sessionId);
        if (!isActive) {
            stuckCampaigns.push(campaign);
        }
    }

    return stuckCampaigns;
}

/**
 * Reassign a campaign to a new active session
 */
async function reassignCampaign(
    campaign: any,
    newSession: any,
    activeSessions: any[]
): Promise<{ success: boolean; messagesReassigned: number; error?: string }> {
    try {
        console.log(`[RECOVERY] Reassigning campaign "${campaign.name}" from ${campaign.session.sessionId} to ${newSession.sessionId}`);

        // Get all pending AND waiting messages for this campaign
        // FIXED: Include 'waiting' status for messages that failed due to session errors
        const allMessages = await prisma.message.findMany({
            where: {
                campaignId: campaign.id,
                status: { in: ['pending', 'waiting'] }, // ← FIXED: Include 'waiting'
            },
            include: {
                contact: true,
            },
        });

        // =====================================================
        // SMART JOB PRIORITIZATION
        // =====================================================
        // Prioritize messages yang belum pernah dicoba (fresh)
        // daripada messages yang sudah di-attempt session sebelumnya
        const freshMessages = allMessages.filter((msg: any) =>
            !msg.lastAttemptAt || msg.retryCount === 0
        );

        const attemptedMessages = allMessages.filter((msg: any) =>
            msg.lastAttemptAt && msg.retryCount > 0
        );

        // Sort attempted messages by lastAttemptAt (oldest first)
        attemptedMessages.sort((a: any, b: any) => {
            const timeA = a.lastAttemptAt ? new Date(a.lastAttemptAt).getTime() : 0;
            const timeB = b.lastAttemptAt ? new Date(b.lastAttemptAt).getTime() : 0;
            return timeA - timeB;
        });

        // Combine: fresh messages first, then attempted messages
        const pendingMessages = [...freshMessages, ...attemptedMessages];

        console.log(
            `[RECOVERY] Smart job assignment: ${freshMessages.length} fresh, ${attemptedMessages.length} attempted (total: ${pendingMessages.length})`
        );

        if (pendingMessages.length === 0) {
            console.log(`[RECOVERY] No pending messages for campaign ${campaign.id}`);

            // Check if campaign should be marked as complete
            const totalMessages = await prisma.message.count({
                where: { campaignId: campaign.id },
            });

            const sentMessages = await prisma.message.count({
                where: { campaignId: campaign.id, status: 'sent' },
            });

            if (totalMessages > 0 && sentMessages === totalMessages) {
                await prisma.campaign.update({
                    where: { id: campaign.id },
                    data: { status: 'sent' },
                });
                console.log(`[RECOVERY] Campaign ${campaign.id} marked as complete`);
            }

            return { success: true, messagesReassigned: 0 };
        }

        // Update campaign to use new session
        await prisma.campaign.update({
            where: { id: campaign.id },
            data: {
                sessionId: newSession.id,
            },
        });

        // Get campaign message variants
        const variants: string[] =
            Array.isArray(campaign.variants) && campaign.variants.length > 0
                ? campaign.variants.map((m: any) => String(m ?? '').trim()).filter((m: string) => m.length > 0)
                : [String(campaign.message ?? '').trim()].filter((m: string) => m.length > 0);

        if (variants.length === 0) {
            return {
                success: false,
                messagesReassigned: 0,
                error: 'Campaign message is empty',
            };
        }

        // Get campaign buttons
        const btns = campaign.buttons.map((b: any) => ({
            label: b.label,
            url: b.url,
        }));

        // Re-queue all pending messages with new session
        const campaignQueue = getCampaignQueue(newSession.sessionId);
        let messageIndex = 0;
        const BATCH_SIZE = 500;
        const batchIndex = 0;

        for (const msg of pendingMessages) {
            const selectedMessage = variants[messageIndex % variants.length];

            // ⭐ Use unique jobId to prevent duplicate jobs in queue
            const jobId = `${campaign.id}_${msg.contact.id}`;

            await campaignQueue.add({
                campaignId: campaign.id,
                contactId: msg.contact.id,
                phoneNumber: msg.contact.phoneNumber,
                message: selectedMessage,
                imageUrl: campaign.imageUrl,
                buttons: btns,
                sessionName: newSession.sessionId,
                messageIndex: messageIndex,
                batchIndex: batchIndex,
            }, {
                // Prevent duplicate jobs with same jobId
                jobId: jobId,
                removeOnComplete: 100, // Keep last 100 completed jobs
                removeOnFail: 50,      // Keep last 50 failed jobs
            });

            messageIndex++;
        }

        console.log(
            `[RECOVERY] Successfully reassigned ${pendingMessages.length} messages from campaign "${campaign.name}" to session ${newSession.sessionId}`
        );

        return {
            success: true,
            messagesReassigned: pendingMessages.length,
        };
    } catch (error: any) {
        console.error(`[RECOVERY] Error reassigning campaign ${campaign.id}:`, error);
        return {
            success: false,
            messagesReassigned: 0,
            error: error.message || 'Failed to reassign campaign',
        };
    }
}

/**
 * Main recovery function - recovers all stuck campaigns
 */
export async function recoverFailedCampaigns(): Promise<RecoveryResult> {
    console.log('[RECOVERY] Starting campaign recovery process...');

    try {
        // Get active sessions
        const activeSessions = await getActiveSessions();
        if (activeSessions.length === 0) {
            console.warn('[RECOVERY] No active sessions available for recovery');
            return {
                success: false,
                campaignsRecovered: 0,
                messagesReassigned: 0,
                details: [],
            };
        }

        console.log(`[RECOVERY] Found ${activeSessions.length} active sessions`);

        // Get stuck campaigns
        const stuckCampaigns = await getStuckCampaigns();
        if (stuckCampaigns.length === 0) {
            console.log('[RECOVERY] No stuck campaigns found');
            return {
                success: true,
                campaignsRecovered: 0,
                messagesReassigned: 0,
                details: [],
            };
        }

        console.log(`[RECOVERY] Found ${stuckCampaigns.length} stuck campaigns`);

        const results = [];
        let sessionIndex = 0;
        let totalMessagesReassigned = 0;

        // Process each stuck campaign
        for (const campaign of stuckCampaigns) {
            // Round-robin: assign to next available session
            const newSession = activeSessions[sessionIndex % activeSessions.length];

            const result = await reassignCampaign(campaign, newSession, activeSessions);

            if (result.success) {
                results.push({
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    oldSession: campaign.session.sessionId,
                    newSession: newSession.sessionId,
                    pendingMessages: result.messagesReassigned,
                });

                totalMessagesReassigned += result.messagesReassigned;
                sessionIndex++; // Move to next session for next campaign
            }
        }

        console.log(
            `[RECOVERY] Completed: ${results.length} campaigns recovered, ${totalMessagesReassigned} messages reassigned`
        );

        return {
            success: true,
            campaignsRecovered: results.length,
            messagesReassigned: totalMessagesReassigned,
            details: results,
        };
    } catch (error: any) {
        console.error('[RECOVERY] Error during recovery process:', error);
        return {
            success: false,
            campaignsRecovered: 0,
            messagesReassigned: 0,
            details: [],
        };
    }
}

/**
 * Auto-recovery scheduler - call this periodically (e.g., every 5 minutes)
 */
export async function scheduleAutoRecovery(intervalMs: number = 300000) {
    console.log(`[RECOVERY] Starting auto-recovery scheduler (interval: ${intervalMs}ms)`);

    // Run immediately on start
    await recoverFailedCampaigns();

    // Then run periodically
    setInterval(async () => {
        await recoverFailedCampaigns();
    }, intervalMs);
}
