import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

/**
 * Initialize Socket.IO server
 * @param httpServer - HTTP server instance from Express
 */
export function initializeSocketIO(httpServer: HTTPServer) {
    io = new SocketIOServer(httpServer, {
        cors: {
            origin: '*', // Match Express CORS config
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });

    io.on('connection', (socket) => {
        console.log(`✅ [WebSocket] Client connected: ${socket.id}`);

        socket.on('disconnect', () => {
            console.log(`❌ [WebSocket] Client disconnected: ${socket.id}`);
        });
    });

    console.log('🔌 [WebSocket] Socket.IO server initialized');
    return io;
}

/**
 * Get Socket.IO instance
 */
export function getIO(): SocketIOServer {
    if (!io) {
        throw new Error('Socket.IO not initialized. Call initializeSocketIO first.');
    }
    return io;
}

/**
 * Emit stats update event to all connected clients
 */
export function emitStatsUpdate(data: {
    totalContacts?: number;
    totalCampaigns?: number;
    sentMessages?: number;
    failedMessages?: number;
    activeSessions?: number;
}) {
    if (!io) return;
    io.emit('stats:update', data);
    console.log('📊 [WebSocket] Emitted stats:update', data);
}

/**
 * Emit campaign update event
 */
export function emitCampaignUpdate(data: {
    campaignId: string;
    status?: string;
    sentCount?: number;
    failedCount?: number;
    totalContacts?: number;
}) {
    if (!io) return;
    io.emit('campaign:update', data);
    console.log('📢 [WebSocket] Emitted campaign:update', data);
}

/**
 * Emit message update event
 */
export function emitMessageUpdate(data: {
    campaignId: string;
    contactId: string;
    status: string;
    waMessageId?: string | null;
    errorMsg?: string | null;
}) {
    if (!io) return;
    io.emit('message:update', data);
    console.log('💬 [WebSocket] Emitted message:update', data);
}

/**
 * Emit session update event
 */
export function emitSessionUpdate(data: {
    sessionId: string;
    status: string;
    phoneNumber?: string | null;
}) {
    if (!io) return;
    io.emit('session:update', data);
    console.log('📱 [WebSocket] Emitted session:update', data);
}

export default {
    initializeSocketIO,
    getIO,
    emitStatsUpdate,
    emitCampaignUpdate,
    emitMessageUpdate,
    emitSessionUpdate,
};
