// backend/src/services/session-monitor.service.ts
/**
 * Session Monitor Service
 * 
 * Real-time monitoring untuk mendeteksi session logout dan trigger failover:
 * 1. Monitor session status setiap 30 detik
 * 2. Detect session logout secara real-time
 * 3. Trigger immediate job redistribution ke session yang available
 * 4. Track session yang dalam kondisi standby/resting
 */

import prisma from '../lib/prisma';
import wahaService from './waha.service';
import sessionRotation from './session-rotation.service';
import { getCampaignQueue } from './queue.service';
import { emitSessionUpdate, emitCampaignUpdate } from './socket.service';

// Konfigurasi
const MONITOR_INTERVAL_MS = Number(process.env.SESSION_MONITOR_INTERVAL || 30000); // 30 detik default
const ACTIVE_STATUSES = ['working', 'ready', 'authenticated'];

// Track previous session statuses untuk detect perubahan
const previousSessionStatuses: Map<string, string> = new Map();

/**
 * Check session status dari WAHA
 */
async function checkWAHASessionStatus(sessionId: string): Promise<string> {
    try {
        const status = await wahaService.getSessionStatus(sessionId);
        return (status?.status || 'stopped').toLowerCase();
    } catch (e) {
        return 'stopped';
    }
}

/**
 * Redistribute waiting messages ke session yang available
 * Return jumlah message yang di-requeue
 */
export async function redistributeWaitingMessages(): Promise<number> {
    // Reset rested sessions dulu
    await sessionRotation.resetRestedSessions();

    // Cari message dengan status 'waiting'
    const waitingMessages = await prisma.message.findMany({
        where: {
            status: 'waiting'
        },
        include: {
            contact: true,
            campaign: {
                include: {
                    buttons: true
                }
            }
        },
        orderBy: [
            { createdAt: 'asc' } // Prioritaskan yang paling lama menunggu
        ],
        take: 100 // Limit untuk menghindari overload
    });

    if (waitingMessages.length === 0) {
        return 0;
    }

    console.log(`[SESSION-MONITOR] Found ${waitingMessages.length} waiting messages to redistribute`);

    // Dapatkan session yang available
    const availableSessions = await sessionRotation.getAllAvailableSessions();

    if (availableSessions.length === 0) {
        console.warn('[SESSION-MONITOR] No available sessions for redistribution');
        return 0;
    }

    console.log(`[SESSION-MONITOR] ${availableSessions.length} sessions available for redistribution`);

    let redistributedCount = 0;
    let sessionIndex = 0;

    // Group messages by campaign untuk batch processing
    const messagesByCampaign = new Map<string, typeof waitingMessages>();
    for (const msg of waitingMessages) {
        const existing = messagesByCampaign.get(msg.campaignId) || [];
        existing.push(msg);
        messagesByCampaign.set(msg.campaignId, existing);
    }

    // Process per campaign
    for (const [campaignId, messages] of messagesByCampaign) {
        const firstMsg = messages[0] as any;
        const campaign = firstMsg.campaign;
        if (!campaign) continue;

        // Get message variants
        const variants: string[] =
            Array.isArray(campaign.variants) && campaign.variants.length > 0
                ? campaign.variants.map((m: any) => String(m ?? '').trim()).filter((m: string) => m.length > 0)
                : [String(campaign.message ?? '').trim()].filter((m: string) => m.length > 0);

        if (variants.length === 0) continue;

        // Get buttons
        const btns = campaign.buttons.map((b: any) => ({
            label: b.label,
            url: b.url,
        }));

        for (const msg of messages) {
            const msgAny = msg as any;

            // Round-robin session assignment
            const session = availableSessions[sessionIndex % availableSessions.length];

            // Check if session still available (not reached limit)
            if (session.jobLimitReached) {
                sessionIndex++;
                continue;
            }

            const selectedMessage = variants[redistributedCount % variants.length];

            try {
                // Update message status ke pending
                await prisma.message.update({
                    where: { id: msg.id },
                    data: {
                        status: 'pending',
                        errorMsg: null
                    }
                });

                // Requeue message
                const queue = getCampaignQueue(session.sessionId);
                await queue.add({
                    campaignId: msg.campaignId,
                    contactId: msg.contactId,
                    phoneNumber: msgAny.contact.phoneNumber,
                    message: selectedMessage,
                    imageUrl: campaign.imageUrl,
                    buttons: btns,
                    sessionName: session.sessionId,
                    messageIndex: redistributedCount,
                    batchIndex: 0,
                });

                redistributedCount++;

                // Rotate to next session
                sessionIndex++;

            } catch (error: any) {
                console.error(`[SESSION-MONITOR] Failed to requeue message ${msg.id}:`, error.message);
            }
        }
    }

    if (redistributedCount > 0) {
        console.log(`[SESSION-MONITOR] Successfully redistributed ${redistributedCount} messages`);
    }

    return redistributedCount;
}

/**
 * Handle session logout - mark messages as waiting and trigger redistribution
 */
async function handleSessionLogout(sessionId: string, sessionDbId: string): Promise<void> {
    console.log(`[SESSION-MONITOR] Handling logout for session ${sessionId}`);

    // 1. Mark session as stopped
    await prisma.session.update({
        where: { id: sessionDbId },
        data: {
            status: 'stopped',
            jobLimitReached: false // Reset job limit karena logout
        }
    });

    // 2. Emit session update untuk frontend
    emitSessionUpdate({
        sessionId,
        status: 'stopped',
        phoneNumber: null
    });

    // 3. Mark semua pending messages dari campaign yang menggunakan session ini sebagai waiting
    const activeCampaigns = await prisma.campaign.findMany({
        where: {
            sessionId: sessionDbId,
            status: 'sending'
        },
        select: { id: true, name: true }
    });

    for (const campaign of activeCampaigns) {
        const result = await prisma.message.updateMany({
            where: {
                campaignId: campaign.id,
                status: 'pending'
            },
            data: {
                status: 'waiting',
                errorMsg: `Session ${sessionId} logged out, waiting for redistribution`,
                lastAttemptAt: new Date(),
                lastSessionId: sessionId
            } as any
        });

        if (result.count > 0) {
            console.log(`[SESSION-MONITOR] Marked ${result.count} pending messages as waiting for campaign ${campaign.name}`);
        }

        // Emit campaign update
        const updatedCampaign = await prisma.campaign.findUnique({
            where: { id: campaign.id },
            select: {
                id: true,
                status: true,
                sentCount: true,
                failedCount: true,
                totalContacts: true
            }
        });

        if (updatedCampaign) {
            emitCampaignUpdate({
                campaignId: updatedCampaign.id,
                status: updatedCampaign.status,
                sentCount: updatedCampaign.sentCount,
                failedCount: updatedCampaign.failedCount,
                totalContacts: updatedCampaign.totalContacts
            });
        }
    }

    // 4. Trigger immediate redistribution
    console.log(`[SESSION-MONITOR] Triggering immediate redistribution after logout`);
    await redistributeWaitingMessages();

    // 5. Try to reassign campaigns to other sessions
    await reassignCampaignsToAvailableSessions(activeCampaigns.map(c => c.id));
}

/**
 * Reassign campaigns ke session yang available
 */
async function reassignCampaignsToAvailableSessions(campaignIds: string[]): Promise<void> {
    if (campaignIds.length === 0) return;

    const availableSessions = await sessionRotation.getAllAvailableSessions();
    if (availableSessions.length === 0) {
        console.warn('[SESSION-MONITOR] No available sessions for campaign reassignment');
        return;
    }

    let sessionIndex = 0;

    for (const campaignId of campaignIds) {
        const session = availableSessions[sessionIndex % availableSessions.length];

        await prisma.campaign.update({
            where: { id: campaignId },
            data: { sessionId: session.id }
        });

        console.log(`[SESSION-MONITOR] Reassigned campaign ${campaignId} to session ${session.sessionId}`);
        sessionIndex++;
    }
}

/**
 * Handle session comeback - session yang tadinya offline jadi online lagi
 */
async function handleSessionComeback(sessionId: string, sessionDbId: string): Promise<void> {
    console.log(`[SESSION-MONITOR] Session ${sessionId} is back online`);

    // Update session status
    await prisma.session.update({
        where: { id: sessionDbId },
        data: {
            status: 'working',
            // Reset job tracking jika sudah lama offline
            jobCount: 0,
            jobLimitReached: false,
            restingUntil: null
        }
    });

    // Emit session update
    emitSessionUpdate({
        sessionId,
        status: 'working',
        phoneNumber: null
    });

    // Trigger redistribution untuk assign waiting messages ke session ini
    await redistributeWaitingMessages();
}

/**
 * Monitor all sessions dan detect status changes
 */
async function monitorAllSessions(): Promise<void> {
    try {
        const sessions = await prisma.session.findMany();

        for (const session of sessions) {
            const currentStatus = await checkWAHASessionStatus(session.sessionId);
            const previousStatus = previousSessionStatuses.get(session.sessionId);
            const isCurrentlyActive = ACTIVE_STATUSES.includes(currentStatus);
            const wasActive = previousStatus ? ACTIVE_STATUSES.includes(previousStatus) : ACTIVE_STATUSES.includes(session.status);

            // Update tracking
            previousSessionStatuses.set(session.sessionId, currentStatus);

            // Update DB jika status berubah
            if (session.status !== currentStatus) {
                await prisma.session.update({
                    where: { id: session.id },
                    data: { status: currentStatus }
                });
            }

            // Detect status changes
            if (wasActive && !isCurrentlyActive) {
                // Session went offline - handle logout
                await handleSessionLogout(session.sessionId, session.id);
            } else if (!wasActive && isCurrentlyActive) {
                // Session came back online
                await handleSessionComeback(session.sessionId, session.id);
            }
        }

        // Check dan redistribute waiting messages setiap cycle
        await redistributeWaitingMessages();

        // Check standby sessions (yang sudah selesai rest period)
        await sessionRotation.resetRestedSessions();

    } catch (error: any) {
        console.error('[SESSION-MONITOR] Error during monitoring:', error.message);
    }
}

/**
 * Start session monitor dengan interval
 */
let monitorInterval: NodeJS.Timeout | null = null;

export function startSessionMonitor(intervalMs: number = MONITOR_INTERVAL_MS): void {
    if (monitorInterval) {
        console.log('[SESSION-MONITOR] Monitor already running');
        return;
    }

    console.log(`[SESSION-MONITOR] Starting session monitor (interval: ${intervalMs}ms)`);

    // Run immediately on start
    monitorAllSessions().catch(console.error);

    // Then run periodically
    monitorInterval = setInterval(() => {
        monitorAllSessions().catch(console.error);
    }, intervalMs);
}

/**
 * Stop session monitor
 */
export function stopSessionMonitor(): void {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log('[SESSION-MONITOR] Monitor stopped');
    }
}

export default {
    startSessionMonitor,
    stopSessionMonitor,
    redistributeWaitingMessages,
    monitorAllSessions
};
