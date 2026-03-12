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

const logger = Pino({ level: 'silent' });

interface ProxyConfig {
    enabled: boolean;
    type: 'socks5' | 'http' | 'https';
    host: string;
    port: number;
    username: string;
    password: string;
}

interface SessionData {
    sock: ReturnType<typeof makeWASocket>;
    qr: string | null;
    status: 'STARTING' | 'WORKING' | 'STOPPED' | 'FAILED';
    phone: string | null;
}

class BaileysService {
    private sessions: Map<string, SessionData> = new Map();
    private sessionsDir = path.join(process.cwd(), 'sessions');
    private proxyConfig: ProxyConfig | null = null;

    constructor() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
        // Load proxy config from settings file on startup
        this.loadProxyFromSettings();
    }

    private loadProxyFromSettings() {
        try {
            const settingsFile = path.join(process.cwd(), 'settings.json');
            if (fs.existsSync(settingsFile)) {
                const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
                if (raw.proxy && raw.proxy.enabled) {
                    this.proxyConfig = raw.proxy;
                    console.log(`[BAILEYS] 🌐 Proxy loaded: ${raw.proxy.type}://${raw.proxy.host}:${raw.proxy.port}`);
                }
            }
        } catch (e) {
            console.warn('[BAILEYS] Could not load proxy settings:', e);
        }
    }

    updateProxy(config: ProxyConfig) {
        this.proxyConfig = config.enabled ? config : null;
        console.log(`[BAILEYS] 🌐 Proxy ${config.enabled ? `updated: ${config.type}://${config.host}:${config.port}` : 'DISABLED'}`);
    }

    private async getProxyAgent(): Promise<any> {
        if (!this.proxyConfig || !this.proxyConfig.enabled) return undefined;

        const { type, host, port, username, password } = this.proxyConfig;

        if (type === 'socks5') {
            try {
                const { SocksProxyAgent } = await import('socks-proxy-agent');
                const auth = username && password ? `${username}:${password}@` : '';
                const proxyUrl = `socks5://${auth}${host}:${port}`;
                console.log(`[BAILEYS] 🌐 Using SOCKS5 proxy: ${host}:${port}`);
                return new SocksProxyAgent(proxyUrl);
            } catch (e) {
                console.error('[BAILEYS] Failed to create SOCKS5 agent:', e);
                return undefined;
            }
        } else {
            // HTTP/HTTPS proxy
            try {
                const { HttpsProxyAgent } = await import('https-proxy-agent');
                const auth = username && password ? `${username}:${password}@` : '';
                const proxyUrl = `${type}://${auth}${host}:${port}`;
                console.log(`[BAILEYS] 🌐 Using HTTP proxy: ${host}:${port}`);
                return new HttpsProxyAgent(proxyUrl);
            } catch (e) {
                console.error('[BAILEYS] Failed to create HTTP proxy agent:', e);
                return undefined;
            }
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
        const { version } = await fetchLatestBaileysVersion();

        // 🌐 Get proxy agent if configured
        const agent = await this.getProxyAgent();

        const socketConfig: any = {
            version,
            logger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            generateHighQualityLinkPreview: true,
            browser: ['Chrome (Linux)', 'Chrome', '120.0.0'], // Mimic real Chrome browser
        };

        // Apply proxy agent if available
        if (agent) {
            socketConfig.agent = agent;
            socketConfig.fetchAgent = agent;
            console.log(`[BAILEYS] 🌐 Session ${sessionId} using residential proxy`);
        }

        const sock = makeWASocket(socketConfig);

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

    // High Speed Message Sending
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

        if (buttons && buttons.length > 0) {
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
