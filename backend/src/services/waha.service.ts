// backend/src/services/waha.service.ts
import axios, { AxiosInstance } from 'axios';

export type QRFormat = 'json' | 'png' | 'raw';

export interface QRResponse {
  format: QRFormat;
  // bebas; tergantung WAHA, jadi pakai any saja
  data: any;
}

export interface ScreenshotResponse {
  format: 'json' | 'jpeg';
  data: any;
}

class WahaService {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;
  private readonly requestTimeoutMs: number;

  constructor() {
    this.baseUrl = process.env.WAHA_URL || 'http://localhost:3000';
    this.apiKey = process.env.WAHA_API_KEY || '';
    this.requestTimeoutMs = Number(process.env.WAHA_TIMEOUT_MS || 60000);

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.requestTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'X-Api-Key': this.apiKey }),
        ...(this.apiKey && { 'x-api-key': this.apiKey }),
      },
    });

    console.log(
      '[WAHA] Base URL:',
      this.baseUrl,
      '| API key set:',
      !!this.apiKey,
      '| timeout(ms):',
      this.requestTimeoutMs
    );
  }

  private formatAxiosError(error: any): string {
    if (error?.code === 'ECONNABORTED') return `WAHA request timeout after ${this.requestTimeoutMs}ms`;
    if (error?.response?.status) {
      const status = error.response.status;
      const data = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
      return `WAHA HTTP ${status}: ${data}`;
    }
    return String(error?.message || 'Unknown error');
  }

  // ===== Session Management =====

  async startSession(sessionName: string = 'default') {
    try {
      const response = await this.client.post('/api/sessions/start', {
        name: sessionName,
        config: {
          proxy: null,
          webhooks: [
            {
              url: `${process.env.BACKEND_URL || 'http://backend:4000'}/webhook/whatsapp`,
              events: ['message', 'session.status'],
            },
          ],
        },
      });

      return response.data;
    } catch (error: any) {
      console.error('[WAHA] Failed to start session:', error?.response?.data || error?.message);
      throw new Error(`Failed to start session: ${error?.message || 'Unknown error'}`);
    }
  }

  async stopSession(sessionName: string = 'default') {
    try {
      const response = await this.client.post('/api/sessions/stop', {
        name: sessionName,
      });
      return response.data;
    } catch (error: any) {
      console.error('[WAHA] Failed to stop session:', error?.response?.data || error?.message);
      throw new Error(`Failed to stop session: ${error?.message || 'Unknown error'}`);
    }
  }

  async logoutSession(sessionName: string = 'default') {
    try {
      // WAHA variants differ by version; try a couple of common routes.
      const candidates: Array<() => Promise<any>> = [
        () => this.client.post('/api/sessions/logout', { name: sessionName }, { validateStatus: () => true }),
        () => this.client.post(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, {}, { validateStatus: () => true }),
      ];

      let last: any = null;
      for (const call of candidates) {
        const resp = await call();
        last = resp;
        if (resp.status >= 200 && resp.status < 300) return resp.data;
      }

      console.warn('[WAHA] Logout returned non-2xx (all candidates)', {
        sessionName,
        status: last?.status,
        data: last?.data,
      });
      return last?.data;
    } catch (error: any) {
      console.error('[WAHA] Failed to logout session:', error?.response?.data || error?.message);
      throw new Error(`Failed to logout session: ${error?.message || 'Unknown error'}`);
    }
  }

  async deleteSession(sessionName: string = 'default') {
    try {
      // Confirmed by user curl: DELETE /api/sessions/:name
      // Keep a fallback for older variants.
      const candidates: Array<() => Promise<any>> = [
        () => this.client.delete(`/api/sessions/${encodeURIComponent(sessionName)}`, { validateStatus: () => true }),
        () => this.client.post('/api/sessions/delete', { name: sessionName }, { validateStatus: () => true }),
      ];

      let last: any = null;
      for (const call of candidates) {
        const resp = await call();
        last = resp;
        if (resp.status >= 200 && resp.status < 300) return resp.data;
      }

      console.warn('[WAHA] Delete returned non-2xx (all candidates)', {
        sessionName,
        status: last?.status,
        data: last?.data,
      });
      return last?.data;
    } catch (error: any) {
      console.error('[WAHA] Failed to delete session:', error?.response?.data || error?.message);
      throw new Error(`Failed to delete session: ${error?.message || 'Unknown error'}`);
    }
  }

  async getQRCode(sessionName: string = 'default'): Promise<QRResponse> {
    try {
      // 1. JSON (base64)
      const jsonResp = await this.client.get(`/api/${encodeURIComponent(sessionName)}/auth/qr`, {
        headers: { accept: 'application/json' },
        validateStatus: () => true,
      });

      if (jsonResp.status === 200 && jsonResp.data) {
        return { format: 'json', data: jsonResp.data };
      }

      // 2. PNG binary
      const pngResp = await this.client.get(`/api/${encodeURIComponent(sessionName)}/auth/qr`, {
        headers: { accept: 'image/png' },
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });

      if (pngResp.status === 200 && pngResp.data) {
        const base64 = Buffer.from(pngResp.data, 'binary').toString('base64');
        return { format: 'png', data: `data:image/png;base64,${base64}` };
      }

      // 3. Raw text value
      const rawResp = await this.client.get(`/api/${encodeURIComponent(sessionName)}/auth/qr`, {
        headers: { accept: 'application/json' },
        params: { format: 'raw' },
        validateStatus: () => true,
      });

      if (rawResp.status === 200 && rawResp.data) {
        return { format: 'raw', data: rawResp.data };
      }

      console.error('[WAHA][QR] All formats failed', {
        jsonStatus: jsonResp.status,
        pngStatus: pngResp.status,
        rawStatus: rawResp.status,
      });

      throw new Error('WAHA QR endpoint returned non-200 for all formats');
    } catch (error: any) {
      console.error('[WAHA][QR] Failed to get QR code:', error?.response?.data || error?.message);
      throw new Error(`Failed to get QR code: ${error?.message || 'Unknown error'}`);
    }
  }

  async requestPairingCode(sessionName: string, phoneNumber: string) {
    try {
      const response = await this.client.post(
        `/api/${encodeURIComponent(sessionName)}/auth/request-code`,
        { phoneNumber },
        {
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
        }
      );

      if (response.status < 200 || response.status >= 300) {
        console.error('[WAHA][PAIR] Non-2xx response', {
          status: response.status,
          data: response.data,
        });
        throw new Error(`WAHA pairing endpoint returned ${response.status}`);
      }

      return response.data;
    } catch (error: any) {
      console.error('[WAHA][PAIR] Failed to request pairing code:', error?.response?.data || error?.message);
      throw new Error(`Failed to request pairing code: ${error?.message || 'Unknown error'}`);
    }
  }

  async getSessionScreenshot(sessionName: string = 'default'): Promise<ScreenshotResponse> {
    const url = `/api/screenshot?session=${encodeURIComponent(sessionName)}`;

    try {
      // 1. JSON (Base64File)
      const jsonResp = await this.client.get(url, {
        headers: { accept: 'application/json' },
        responseType: 'json',
        validateStatus: () => true,
      });

      if (jsonResp.status === 200 && jsonResp.data) {
        return { format: 'json', data: jsonResp.data };
      }

      // 2. JPEG binary
      const jpegResp = await this.client.get(url, {
        headers: { accept: 'image/jpeg' },
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });

      if (jpegResp.status === 200 && jpegResp.data) {
        const base64 = Buffer.from(jpegResp.data, 'binary').toString('base64');
        return { format: 'jpeg', data: `data:image/jpeg;base64,${base64}` };
      }

      console.warn('[WAHA][SCREENSHOT] Non-200 for both JSON and JPEG', {
        jsonStatus: jsonResp.status,
        jpegStatus: jpegResp.status,
      });

      throw new Error('Screenshot endpoint returned non-200');
    } catch (error: any) {
      console.error('[WAHA][SCREENSHOT] Failed to get screenshot:', error?.response?.data || error?.message);
      throw new Error(`Failed to get session screenshot: ${error?.message || 'Unknown error'}`);
    }
  }

  async getSessionStatus(sessionName: string = 'default') {
    try {
      const response = await this.client.get(`/api/sessions/${encodeURIComponent(sessionName)}`);
      return response.data;
    } catch (error: any) {
      console.error('[WAHA] Failed to get session status:', error?.response?.data || error?.message);
      throw new Error(`Failed to get session status: ${error?.message || 'Unknown error'}`);
    }
  }

  async listSessions() {
    try {
      const response = await this.client.get('/api/sessions');
      return response.data;
    } catch (error: any) {
      console.error('[WAHA] Failed to list sessions:', error?.response?.data || error?.message);
      throw new Error(`Failed to list sessions: ${error?.message || 'Unknown error'}`);
    }
  }

  // ===== Messaging =====

  async sendTextMessage(sessionName: string, phoneNumber: string, text: string) {
    try {
      const response = await this.client.post('/api/sendText', {
        session: sessionName,
        chatId: `${phoneNumber}@c.us`,
        text,
      });
      return response.data;
    } catch (error: any) {
      const msg = this.formatAxiosError(error);
      console.error('[WAHA] Failed to send text message:', msg);
      throw new Error(`Failed to send text message: ${msg}`);
    }
  }

  async sendImageMessage(
    sessionName: string,
    phoneNumber: string,
    imageUrl: string,
    caption?: string
  ) {
    try {
      const response = await this.client.post('/api/sendImage', {
        session: sessionName,
        chatId: `${phoneNumber}@c.us`,
        file: {
          url: imageUrl,
        },
        caption,
      });
      return response.data;
    } catch (error: any) {
      const msg = this.formatAxiosError(error);
      console.error('[WAHA] Failed to send image message:', msg);
      throw new Error(`Failed to send image message: ${msg}`);
    }
  }

  async sendButtonMessage(
    sessionName: string,
    phoneNumber: string,
    text: string,
    buttons: Array<{ id: string; text: string }>,
    imageUrl?: string
  ) {
    try {
      const payload: any = {
        session: sessionName,
        chatId: `${phoneNumber}@c.us`,
        text,
        buttons,
      };

      if (imageUrl) {
        payload.footer = '';
        payload.image = { url: imageUrl };
      }

      const response = await this.client.post('/api/sendButtons', payload);
      return response.data;
    } catch (error: any) {
      const msg = this.formatAxiosError(error);
      console.error('[WAHA] Failed to send button message:', msg);
      throw new Error(`Failed to send button message: ${msg}`);
    }
  }

  // WAHA Free: kirim URL sebagai teks pengganti tombol native
  async sendMessageWithButtons(
    sessionName: string,
    phoneNumber: string,
    message: string,
    imageUrl: string | null,
    buttons: Array<{ label: string; url: string }>
  ) {
    try {
      let fullMessage = message + '\n\n';

      buttons.forEach((btn, index) => {
        fullMessage += `${index + 1}. ${btn.label}: ${btn.url}\n`;
      });

      if (imageUrl) {
        return await this.sendImageMessage(sessionName, phoneNumber, imageUrl, fullMessage);
      }

      return await this.sendTextMessage(sessionName, phoneNumber, fullMessage);
    } catch (error: any) {
      const msg = this.formatAxiosError(error);
      console.error('[WAHA] Failed to send message with buttons:', msg);
      throw new Error(`Failed to send message with buttons: ${msg}`);
    }
  }
}

const wahaService = new WahaService();
export default wahaService;
