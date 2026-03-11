import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import Pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';
import { emitSessionUpdate } from './socket.service';
import prisma from '../lib/prisma'; // Optional: if you update DB directly from here, but usually caller does it.

const logger = Pino({ level: 'silent' });

interface SessionData {
    sock: ReturnType<typeof makeWASocket>;
    qr: string | null;
    status: 'STARTING' | 'WORKING' | 'STOPPED' | 'FAILED';
    phone: string | null;
}

class BaileysService {
    private sessions: Map<string, SessionData> = new Map();
    private sessionsDir = path.join(process.cwd(), 'sessions');

    constructor() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    private getSessionDir(sessionId: string) {
        return path.join(this.sessionsDir, `session-${sessionId}`);
    }

    async startSession(sessionId: string) {
        console.log(`[BAILEYS] Starting session: ${sessionId}`);
        
        if (this.sessions.has(sessionId)) {
            const current = this.sessions.get(sessionId)!;
            if (current.status === 'WORKING') return { success: true, message: 'Already running' };
        }

        const sessionDir = this.getSessionDir(sessionId);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version, isLatest } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            generateHighQualityLinkPreview: true,
            browser: ['WA Broadcast V2', 'Chrome', '1.0.0'], // Mimic Ninja
        });

        const sessionData: SessionData = {
            sock,
            qr: null,
            status: 'STARTING',
            phone: state.creds.me?.id ? state.creds.me.id.split(':')[0] : null,
        };

        this.sessions.set(sessionId, sessionData);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`[BAILEYS] QR generated for ${sessionId}`);
                try {
                    const qrDataUrl = await QRCode.toDataURL(qr);
                    sessionData.qr = qrDataUrl;
                    sessionData.status = 'STARTING';
                    
                    emitSessionUpdate({
                        sessionId,
                        status: 'STARTING',
                        phoneNumber: null,
                    });
                } catch (e) {
                    console.error('[BAILEYS] QR Generate Error:', e);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`[BAILEYS] Session ${sessionId} closed. Reconnect: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    sessionData.status = 'STARTING';
                    // Optional backoff reconnect
                    setTimeout(() => this.startSession(sessionId), 5000);
                } else {
                    sessionData.status = 'STOPPED';
                    sessionData.qr = null;
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    }
                    emitSessionUpdate({ sessionId, status: 'stopped', phoneNumber: null });
                }
            } else if (connection === 'open') {
                console.log(`[BAILEYS] Session ${sessionId} connected!`);
                sessionData.status = 'WORKING';
                sessionData.qr = null;
                sessionData.phone = sock.user?.id ? sock.user.id.split(':')[0] : null;
                
                emitSessionUpdate({
                    sessionId,
                    status: 'working',
                    phoneNumber: sessionData.phone,
                });
            }
        });

        return { success: true, sessionId };
    }

    async getSessionStatus(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (!session) return { status: 'STOPPED' };
        
        return {
            status: session.status,
            me: { id: session.phone }
        };
    }

    async getQRCode(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.qr) {
            throw new Error('QR code not available or session already connected');
        }
        return { format: 'raw', data: session.qr };
    }

    async getSessionScreenshot(sessionId: string) {
        // Fallback for session.routes.ts mapping
        return this.getQRCode(sessionId);
    }

    async stopSession(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.sock.end(undefined);
            session.status = 'STOPPED';
        }
        return { success: true };
    }

    async logoutSession(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.sock.logout();
            session.status = 'STOPPED';
        }
        const sessionDir = this.getSessionDir(sessionId);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        return { success: true };
    }

    async deleteSession(sessionId: string) {
        return this.logoutSession(sessionId);
    }

    async requestPairingCode(sessionId: string, phoneNumber: string) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found or not started');
        
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        const code = await session.sock.requestPairingCode(cleanNumber);
        return { code };
    }

    // High Speed Message Sending (60/s)
    async sendMessageWithButtons(
        sessionId: string,
        phoneNumber: string,
        text: string,
        imageUrl: string | null = null,
        buttons: { label: string; url: string }[] = []
    ) {
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'WORKING') {
            throw new Error('Session is not connected');
        }

        const jid = `${phoneNumber.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        
        let messageConfig: any = {};

        // Convert UI generic buttons into actual WhatsApp Buttons/Template/Interactive
        // NOTE: Standard Baileys buttons require standard WhatsApp Interactive Message structure.
        // For mass sending safety and speed, plain text + URLs is best. But let's support it if needed.
        if (buttons && buttons.length > 0) {
            // Very basic CTAs - Baileys implementation of buttons can be tricky 
            // depending on Meta's current rules. We'll send standard text with links appended 
            // for maximum 60/s stabillity, or use the interactive template.
            const buttonText = buttons.map(b => `[${b.label}] ${b.url}`).join('\n');
            text = `${text}\n\n${buttonText}`;
        }

        if (imageUrl) {
            messageConfig = {
                image: { url: imageUrl },
                caption: text
            };
        } else {
            messageConfig = { text };
        }

        // Direct Socket Send 🚀
        const sentMsg = await session.sock.sendMessage(jid, messageConfig);
        return { id: sentMsg?.key.id };
    }
}

const baileysService = new BaileysService();
export default baileysService;
