// backend/src/routes/settings.routes.ts
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
router.use(authMiddleware);

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

interface AppSettings {
  proxy: {
    enabled: boolean;
    type: 'socks5' | 'http' | 'https';
    host: string;
    port: number;
    username: string;
    password: string;
  };
}

function getDefaultSettings(): AppSettings {
  return {
    proxy: {
      enabled: false,
      type: 'socks5',
      host: '',
      port: 1080,
      username: '',
      password: '',
    },
  };
}

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...getDefaultSettings(), ...JSON.parse(raw) };
    }
  } catch (e) {
    console.warn('[SETTINGS] Failed to load settings file:', e);
  }
  return getDefaultSettings();
}

function saveSettings(settings: AppSettings): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// GET /api/settings — get current settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = loadSettings();
    // Mask password in response
    const safeSettings = {
      ...settings,
      proxy: {
        ...settings.proxy,
        password: settings.proxy.password ? '********' : '',
      },
    };
    return res.json({ success: true, data: safeSettings });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/settings/proxy — update proxy settings
router.put('/proxy', async (req: Request, res: Response) => {
  try {
    const { enabled, type, host, port, username, password } = req.body;
    const settings = loadSettings();

    settings.proxy = {
      enabled: !!enabled,
      type: type || 'socks5',
      host: host || '',
      port: Number(port) || 1080,
      username: username || '',
      // Keep old password if masked value sent
      password: password === '********' ? settings.proxy.password : (password || ''),
    };

    saveSettings(settings);

    // Notify Baileys service to update proxy
    const baileysService = (await import('../services/waha.service')).default;
    baileysService.updateProxy(settings.proxy);

    console.log(`[SETTINGS] Proxy updated: ${settings.proxy.enabled ? `${settings.proxy.type}://${settings.proxy.host}:${settings.proxy.port}` : 'DISABLED'}`);

    return res.json({
      success: true,
      message: settings.proxy.enabled
        ? `Proxy aktif: ${settings.proxy.type}://${settings.proxy.host}:${settings.proxy.port}`
        : 'Proxy dinonaktifkan',
    });
  } catch (error: any) {
    console.error('[SETTINGS] Error updating proxy:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/settings/proxy/test — test proxy connectivity
router.post('/proxy/test', async (req: Request, res: Response) => {
  try {
    const { type, host, port, username, password } = req.body;

    if (!host || !port) {
      return res.status(400).json({ success: false, message: 'Host and port are required' });
    }

    // Quick connectivity test
    const net = await import('net');
    const testResult = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(Number(port), host);
    });

    if (testResult) {
      return res.json({ success: true, message: `✅ Proxy ${type}://${host}:${port} is reachable!` });
    } else {
      return res.json({ success: false, message: `❌ Cannot connect to ${host}:${port}` });
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
