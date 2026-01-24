// backend/src/services/session-rotation.service.ts
/**
 * Session Rotation Service
 * 
 * Mengelola rotasi session untuk menghindari suspend/banned WhatsApp:
 * 1. Membatasi setiap session hanya 30 job per periode
 * 2. Prioritaskan session yang belum bekerja atau sudah istirahat
 * 3. Auto-reassign message failed karena logout ke session lain
 */

import prisma from '../lib/prisma';

// Konfigurasi dari environment variables
const JOB_LIMIT = Number(process.env.SESSION_JOB_LIMIT || 30);
const REST_HOURS = Number(process.env.SESSION_REST_HOURS || 1);

// Status session yang dianggap aktif/connected
const ACTIVE_STATUSES = ['working', 'ready', 'authenticated'];

/**
 * Reset session yang sudah selesai istirahat
 */
export async function resetRestedSessions(): Promise<number> {
    const result = await prisma.session.updateMany({
        where: {
            restingUntil: { lt: new Date() },
            jobLimitReached: true
        },
        data: {
            jobLimitReached: false,
            jobCount: 0,
            restingUntil: null
        }
    });

    if (result.count > 0) {
        console.log(`[SESSION-ROTATION] Reset ${result.count} rested sessions`);
    }

    return result.count;
}

/**
 * Cek apakah session available untuk bekerja
 */
export function isSessionAvailable(session: {
    status: string;
    jobLimitReached: boolean;
    restingUntil: Date | null;
}): boolean {
    const normalizedStatus = (session.status || '').toLowerCase();
    const isConnected = ACTIVE_STATUSES.includes(normalizedStatus);
    const isNotResting = !session.jobLimitReached &&
        (!session.restingUntil || session.restingUntil < new Date());

    return isConnected && isNotResting;
}

/**
 * Dapatkan session terbaik untuk mengirim campaign
 * Prioritas:
 * 1. Session connected yang belum mencapai limit
 * 2. Session dengan job count terendah (yang paling sedikit bekerja)
 */
export async function getBestAvailableSession(excludeSessionIds: string[] = []): Promise<any | null> {
    // Reset session yang sudah selesai istirahat dulu
    await resetRestedSessions();

    // Cari session terbaik
    const session = await prisma.session.findFirst({
        where: {
            status: { in: ACTIVE_STATUSES },
            jobLimitReached: false,
            ...(excludeSessionIds.length > 0 && {
                id: { notIn: excludeSessionIds }
            }),
            OR: [
                { restingUntil: null },
                { restingUntil: { lt: new Date() } }
            ]
        },
        orderBy: { jobCount: 'asc' } // Prioritas yang paling sedikit bekerja
    });

    if (session) {
        console.log(`[SESSION-ROTATION] Best available session: ${session.name} (jobCount: ${session.jobCount})`);
    }

    return session;
}

/**
 * Dapatkan semua session yang available
 */
export async function getAllAvailableSessions(): Promise<any[]> {
    await resetRestedSessions();

    return await prisma.session.findMany({
        where: {
            status: { in: ACTIVE_STATUSES },
            jobLimitReached: false,
            OR: [
                { restingUntil: null },
                { restingUntil: { lt: new Date() } }
            ]
        },
        orderBy: { jobCount: 'asc' }
    });
}

/**
 * Increment job count dan cek limit
 * Return true jika session mencapai limit setelah increment
 */
export async function incrementJobCount(sessionId: string): Promise<boolean> {
    // Increment job count
    const session = await prisma.session.update({
        where: { sessionId },
        data: {
            jobCount: { increment: 1 },
            lastJobAt: new Date()
        }
    });

    // Cek apakah mencapai limit
    if (session.jobCount >= JOB_LIMIT) {
        const restUntil = new Date(Date.now() + REST_HOURS * 60 * 60 * 1000);

        await prisma.session.update({
            where: { sessionId },
            data: {
                jobLimitReached: true,
                restingUntil: restUntil
            }
        });

        console.log(`[SESSION-ROTATION] Session ${session.name} reached job limit (${JOB_LIMIT}), resting until ${restUntil.toISOString()}`);
        return true;
    }

    return false;
}

/**
 * Mark session as unavailable (untuk kasus logout/suspend)
 */
export async function markSessionUnavailable(sessionId: string): Promise<void> {
    try {
        await prisma.session.update({
            where: { sessionId },
            data: { status: 'stopped' }
        });
        console.log(`[SESSION-ROTATION] Session ${sessionId} marked as unavailable`);
    } catch (error: any) {
        console.warn(`[SESSION-ROTATION] Failed to mark session unavailable:`, error.message);
    }
}

/**
 * Reassign pending messages dari session yang logout ke session lain
 * Return jumlah message yang di-reassign
 */
export async function reassignPendingMessages(
    fromSessionId: string,
    campaignId?: string
): Promise<{ count: number; newSessionId: string | null }> {
    // Cari session pengganti
    const newSession = await getBestAvailableSession([]);

    if (!newSession) {
        console.warn(`[SESSION-ROTATION] No available session to reassign messages`);
        return { count: 0, newSessionId: null };
    }

    // Update semua message dengan status 'failed' karena session logout menjadi 'waiting'
    // supaya bisa di-retry dengan session lain
    const whereClause: any = {
        status: 'failed',
        errorMsg: { contains: 'session' } // Error terkait session
    };

    if (campaignId) {
        whereClause.campaignId = campaignId;
    }

    const result = await prisma.message.updateMany({
        where: whereClause,
        data: {
            status: 'waiting', // Status baru: waiting for retry
            errorMsg: null
        }
    });

    if (result.count > 0) {
        console.log(`[SESSION-ROTATION] Reassigned ${result.count} messages to waiting status`);
    }

    return { count: result.count, newSessionId: newSession.sessionId };
}

/**
 * Reset job count untuk session tertentu (manual)
 */
export async function resetSessionJobCount(sessionId: string): Promise<void> {
    await prisma.session.update({
        where: { id: sessionId },
        data: {
            jobCount: 0,
            jobLimitReached: false,
            restingUntil: null
        }
    });
    console.log(`[SESSION-ROTATION] Reset job count for session ${sessionId}`);
}

export default {
    resetRestedSessions,
    isSessionAvailable,
    getBestAvailableSession,
    getAllAvailableSessions,
    incrementJobCount,
    markSessionUnavailable,
    reassignPendingMessages,
    resetSessionJobCount,
    JOB_LIMIT,
    REST_HOURS
};
