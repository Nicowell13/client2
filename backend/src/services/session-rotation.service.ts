// backend/src/services/session-rotation.service.ts
/**
 * Session Rotation Service
 * 
 * Mengelola rotasi session untuk menghindari suspend/banned WhatsApp:
 * 1. Membatasi setiap session hanya 30 job per periode
 * 2. Prioritaskan session yang belum bekerja atau sudah istirahat
 * 3. Auto-reassign message failed karena logout ke session lain
 * 4. Daily message limit per session
 * 5. Broadcast hours restriction
 * 6. Session quality scoring
 */

import prisma from '../lib/prisma';

// Konfigurasi dari environment variables
const JOB_LIMIT = Number(process.env.SESSION_JOB_LIMIT || 30);
const REST_HOURS = Number(process.env.SESSION_REST_HOURS || 1);

// Daily limit dan broadcast hours
const DAILY_MESSAGE_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT || 40);
const BROADCAST_START_HOUR = Number(process.env.BROADCAST_START_HOUR || 10);
const BROADCAST_END_HOUR = Number(process.env.BROADCAST_END_HOUR || 22);

// Quality scoring
const QUALITY_SUCCESS_BONUS = 0.5;    // Point gained per success
const QUALITY_ERROR_PENALTY = 5;      // Point lost per error
const QUALITY_SESSION_ERROR_PENALTY = 20; // Point lost per session error
const QUALITY_MIN_THRESHOLD = 50;     // Below this, session is paused

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

/**
 * Get sessions yang dalam kondisi standby (sudah selesai resting, siap bekerja lagi)
 */
export async function getStandbySessions(): Promise<any[]> {
    // Reset dulu session yang sudah selesai istirahat
    await resetRestedSessions();

    // Cari session yang baru saja selesai resting
    return await prisma.session.findMany({
        where: {
            status: { in: ACTIVE_STATUSES },
            jobCount: 0, // Sudah di-reset
            jobLimitReached: false
        },
        orderBy: { updatedAt: 'desc' } // Yang baru selesai resting duluan
    });
}

/**
 * Get count of waiting messages yang perlu di-redistribute
 */
export async function getWaitingMessagesCount(): Promise<number> {
    return await prisma.message.count({
        where: { status: 'waiting' }
    });
}

/**
 * Force redistribute semua waiting messages (triggered manually atau saat ada session baru available)
 */
export async function forceRedistributeWaitingMessages(sessionId?: string): Promise<number> {
    const availableSession = sessionId
        ? await prisma.session.findFirst({ where: { sessionId, status: { in: ACTIVE_STATUSES } } })
        : await getBestAvailableSession([]);

    if (!availableSession) {
        console.warn('[SESSION-ROTATION] No available session for redistribution');
        return 0;
    }

    // Update waiting messages ke pending supaya bisa di-pickup oleh queue
    const result = await prisma.message.updateMany({
        where: { status: 'waiting' },
        data: {
            status: 'pending',
            errorMsg: null
        }
    });

    if (result.count > 0) {
        console.log(`[SESSION-ROTATION] Force redistributed ${result.count} waiting messages`);
    }

    return result.count;
}

// ========================================================
// DAILY LIMIT & BROADCAST HOURS (NEW)
// ========================================================

/**
 * Get current hour in Jakarta timezone (UTC+7)
 */
function getJakartaHour(): number {
    const now = new Date();
    // Offset untuk Jakarta (UTC+7)
    const jakartaOffset = 7 * 60; // dalam menit
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const jakartaMinutes = utcMinutes + jakartaOffset;
    return Math.floor((jakartaMinutes % 1440) / 60); // 1440 = total menit dalam sehari
}

/**
 * Get start of today in Jakarta timezone
 */
function getJakartaTodayStart(): Date {
    const now = new Date();
    const jakartaOffset = 7 * 60 * 60 * 1000; // 7 hours in ms
    const jakartaNow = new Date(now.getTime() + jakartaOffset);
    const jakartaToday = new Date(jakartaNow.getFullYear(), jakartaNow.getMonth(), jakartaNow.getDate());
    return new Date(jakartaToday.getTime() - jakartaOffset);
}

/**
 * Cek apakah sekarang dalam jam broadcast yang diizinkan
 */
export function isWithinBroadcastHours(): boolean {
    const currentHour = getJakartaHour();
    const isWithin = currentHour >= BROADCAST_START_HOUR && currentHour < BROADCAST_END_HOUR;

    if (!isWithin) {
        console.log(`[SESSION-ROTATION] Outside broadcast hours. Current: ${currentHour}:00, Allowed: ${BROADCAST_START_HOUR}:00-${BROADCAST_END_HOUR}:00`);
    }

    return isWithin;
}

/**
 * Reset daily counts jika sudah hari baru
 */
export async function resetDailyCountsIfNewDay(): Promise<number> {
    const todayStart = getJakartaTodayStart();

    const result = await prisma.session.updateMany({
        where: {
            OR: [
                { lastDailyReset: null },
                { lastDailyReset: { lt: todayStart } }
            ]
        },
        data: {
            dailyMessageCount: 0,
            lastDailyReset: new Date()
        }
    });

    if (result.count > 0) {
        console.log(`[SESSION-ROTATION] Reset daily counts for ${result.count} sessions`);
    }

    return result.count;
}

/**
 * Cek apakah session sudah mencapai daily limit
 */
export async function checkDailyLimit(sessionId: string): Promise<boolean> {
    // Reset dulu jika hari baru
    await resetDailyCountsIfNewDay();

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { dailyMessageCount: true }
    });

    if (!session) return true; // Block if session not found

    const hasReached = session.dailyMessageCount >= DAILY_MESSAGE_LIMIT;

    if (hasReached) {
        console.log(`[SESSION-ROTATION] Session ${sessionId} reached daily limit (${session.dailyMessageCount}/${DAILY_MESSAGE_LIMIT})`);
    }

    return hasReached;
}

/**
 * Increment daily message count
 */
export async function incrementDailyCount(sessionId: string): Promise<number> {
    const session = await prisma.session.update({
        where: { sessionId },
        data: {
            dailyMessageCount: { increment: 1 }
        }
    });

    return session.dailyMessageCount;
}

// ========================================================
// QUALITY SCORING (NEW)
// ========================================================

/**
 * Update quality score berdasarkan hasil pengiriman
 */
export async function updateQualityScore(
    sessionId: string,
    success: boolean,
    isSessionError: boolean = false
): Promise<number> {
    try {
        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { qualityScore: true, consecutiveErrors: true }
        });

        if (!session) return 0;

        let newScore = session.qualityScore || 100;
        let newConsecutiveErrors = session.consecutiveErrors || 0;

        if (success) {
            // Success: add bonus, reset consecutive errors
            newScore = Math.min(100, newScore + QUALITY_SUCCESS_BONUS);
            newConsecutiveErrors = 0;
        } else if (isSessionError) {
            // Session error: heavy penalty
            newScore = Math.max(0, newScore - QUALITY_SESSION_ERROR_PENALTY);
            newConsecutiveErrors++;
        } else {
            // Regular error: moderate penalty
            newScore = Math.max(0, newScore - QUALITY_ERROR_PENALTY);
            newConsecutiveErrors++;
        }

        const updateData: any = {
            qualityScore: newScore,
            consecutiveErrors: newConsecutiveErrors
        };

        if (!success) {
            updateData.lastErrorAt = new Date();
        }

        // Auto-pause session jika quality terlalu rendah
        if (newScore < QUALITY_MIN_THRESHOLD) {
            updateData.status = 'paused';
            console.warn(`[SESSION-ROTATION] Session ${sessionId} paused due to low quality score (${newScore.toFixed(1)})`);
        }

        await prisma.session.update({
            where: { sessionId },
            data: updateData
        });

        console.log(`[SESSION-ROTATION] Quality score updated for ${sessionId}: ${newScore.toFixed(1)} (consecutive errors: ${newConsecutiveErrors})`);

        return newScore;
    } catch (error: any) {
        console.warn(`[SESSION-ROTATION] Failed to update quality score:`, error.message);
        return 0;
    }
}

/**
 * Get session dengan quality score tertinggi
 */
export async function getHealthiestSession(excludeSessionIds: string[] = []): Promise<any | null> {
    await resetRestedSessions();
    await resetDailyCountsIfNewDay();

    const session = await prisma.session.findFirst({
        where: {
            status: { in: ACTIVE_STATUSES },
            jobLimitReached: false,
            dailyMessageCount: { lt: DAILY_MESSAGE_LIMIT },
            qualityScore: { gte: QUALITY_MIN_THRESHOLD },
            ...(excludeSessionIds.length > 0 && {
                id: { notIn: excludeSessionIds }
            }),
            OR: [
                { restingUntil: null },
                { restingUntil: { lt: new Date() } }
            ]
        },
        orderBy: [
            { qualityScore: 'desc' },  // Prioritas quality tertinggi
            { dailyMessageCount: 'asc' }, // Lalu yang paling sedikit bekerja hari ini
            { jobCount: 'asc' }        // Lalu yang paling sedikit bekerja di periode ini
        ]
    });

    if (session) {
        console.log(`[SESSION-ROTATION] Healthiest session: ${session.name} (quality: ${session.qualityScore?.toFixed(1)}, daily: ${session.dailyMessageCount}/${DAILY_MESSAGE_LIMIT})`);
    }

    return session;
}

/**
 * Check if contact is in cooldown (untuk hindari spam ke kontak yang sama)
 */
export async function isContactInCooldown(contactId: string): Promise<boolean> {
    const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { cooldownUntil: true }
    });

    if (!contact?.cooldownUntil) return false;

    return contact.cooldownUntil > new Date();
}

/**
 * Set cooldown untuk kontak setelah dikirim pesan
 */
export async function setContactCooldown(contactId: string, hoursUntilCooldown: number = 24): Promise<void> {
    const cooldownEnd = new Date(Date.now() + hoursUntilCooldown * 60 * 60 * 1000);

    await prisma.contact.update({
        where: { id: contactId },
        data: {
            lastMessageAt: new Date(),
            messageCount: { increment: 1 },
            cooldownUntil: cooldownEnd
        }
    });
}

// ========================================================
// ROUND-ROBIN SESSION ROTATION (NEW)
// ========================================================

/**
 * Get semua session yang healthy untuk round-robin
 * Criteria: connected, not resting, below daily limit, quality score OK
 */
export async function getAllHealthySessions(): Promise<any[]> {
    await resetRestedSessions();
    await resetDailyCountsIfNewDay();

    const sessions = await prisma.session.findMany({
        where: {
            status: { in: ACTIVE_STATUSES },
            jobLimitReached: false,
            dailyMessageCount: { lt: DAILY_MESSAGE_LIMIT },
            qualityScore: { gte: QUALITY_MIN_THRESHOLD },
            OR: [
                { restingUntil: null },
                { restingUntil: { lt: new Date() } }
            ]
        },
        orderBy: [
            { qualityScore: 'desc' },  // Prioritas quality tertinggi
            { jobCount: 'asc' }        // Lalu yang paling sedikit bekerja
        ]
    });

    console.log(`[SESSION-ROTATION] Found ${sessions.length} healthy sessions for round-robin`);
    return sessions;
}

/**
 * Get session untuk message tertentu menggunakan round-robin
 * @param messageIndex - Index pesan (0, 1, 2, 3, ...)
 * @param availableSessions - Array session yang sudah di-fetch (optional, untuk efisiensi)
 * @returns Session untuk digunakan, atau null jika tidak ada yang available
 */
export async function getNextSessionRoundRobin(
    messageIndex: number,
    availableSessions?: any[]
): Promise<any | null> {
    // Gunakan sessions yang di-pass atau fetch baru
    const sessions = availableSessions || await getAllHealthySessions();

    if (sessions.length === 0) {
        console.warn(`[SESSION-ROTATION] No healthy sessions available for round-robin`);
        return null;
    }

    // Round-robin: pilih session berdasarkan index
    const sessionIndex = messageIndex % sessions.length;
    const selectedSession = sessions[sessionIndex];

    console.log(`[SESSION-ROTATION] Round-robin message ${messageIndex} → session ${selectedSession.name} (index ${sessionIndex}/${sessions.length})`);

    return selectedSession;
}

/**
 * Get next available session jika current session unavailable
 * Fallback yang mempertahankan round-robin pattern
 * ⭐ IMPROVED: Sync status dengan WAHA sebelum failover
 */
export async function getFailoverSession(
    currentSessionId: string,
    messageIndex: number
): Promise<any | null> {
    // First, try with cached healthy sessions
    let sessions = await getAllHealthySessions();
    let availableSessions = sessions.filter(s => s.sessionId !== currentSessionId);

    // If no sessions available from cache, try syncing status from WAHA
    if (availableSessions.length === 0) {
        console.log(`[SESSION-ROTATION] No cached healthy sessions, syncing with WAHA...`);

        // Import wahaService dynamically to avoid circular dependency
        const wahaService = (await import('./waha.service')).default;

        // Get ALL sessions from database (regardless of status)
        const allSessions = await prisma.session.findMany({
            where: {
                NOT: { sessionId: currentSessionId }
            }
        });

        // Check each session's live status from WAHA
        const liveChecks = await Promise.all(
            allSessions.map(async (session) => {
                try {
                    const wahaStatus = await wahaService.getSessionStatus(session.sessionId);
                    const normalizedStatus = (wahaStatus?.status || '').toLowerCase();
                    const isWorking = ['working', 'ready', 'authenticated'].includes(normalizedStatus);

                    // Update database with live status
                    if (isWorking) {
                        await prisma.session.update({
                            where: { id: session.id },
                            data: { status: 'working' }
                        });
                        console.log(`[SESSION-ROTATION] Synced ${session.name}: ${normalizedStatus} (now available)`);
                        return { ...session, status: 'working', isAvailable: true };
                    } else {
                        await prisma.session.update({
                            where: { id: session.id },
                            data: { status: normalizedStatus || 'stopped' }
                        });
                    }
                } catch (err: any) {
                    console.warn(`[SESSION-ROTATION] Failed to check ${session.sessionId}:`, err.message);
                }
                return { ...session, isAvailable: false };
            })
        );

        // Filter sessions that are actually working
        availableSessions = liveChecks.filter(s => s.isAvailable);
        console.log(`[SESSION-ROTATION] Live check found ${availableSessions.length} working sessions`);
    }

    if (availableSessions.length === 0) {
        console.warn(`[SESSION-ROTATION] No failover sessions available after live check`);
        return null;
    }

    // Maintain round-robin pattern with available sessions
    const sessionIndex = messageIndex % availableSessions.length;
    const selectedSession = availableSessions[sessionIndex];

    console.log(`[SESSION-ROTATION] Failover: ${currentSessionId} → ${selectedSession.name || selectedSession.sessionId}`);

    return selectedSession;
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
    getStandbySessions,
    getWaitingMessagesCount,
    forceRedistributeWaitingMessages,
    // New functions
    isWithinBroadcastHours,
    checkDailyLimit,
    incrementDailyCount,
    resetDailyCountsIfNewDay,
    updateQualityScore,
    getHealthiestSession,
    isContactInCooldown,
    setContactCooldown,
    // Round-robin functions
    getAllHealthySessions,
    getNextSessionRoundRobin,
    getFailoverSession,
    // Constants
    JOB_LIMIT,
    REST_HOURS,
    DAILY_MESSAGE_LIMIT,
    BROADCAST_START_HOUR,
    BROADCAST_END_HOUR,
    QUALITY_MIN_THRESHOLD
};

