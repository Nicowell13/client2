import axios, { AxiosInstance } from 'axios';

class WahaService {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.WAHA_URL || 'http://localhost:3000';
    this.apiKey = process.env.WAHA_API_KEY || '';
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        // Send both common header casings just in case
        ...(this.apiKey && { 'X-Api-Key': this.apiKey }),
        ...(this.apiKey && { 'x-api-key': this.apiKey }),
      },
    });

    // Minimal startup log to help diagnose 401s without leaking secrets
    console.log('[WAHA] Base URL:', this.baseUrl, '| API key set:', !!this.apiKey);
  }

  // Session Management
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
      throw new Error(`Failed to start session: ${error.message}`);
    }
  }

  async stopSession(sessionName: string = 'default') {
    try {
      const response = await this.client.post('/api/sessions/stop', {
        name: sessionName,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to stop session: ${error.message}`);
    }
  }

  async getQRCode(sessionName: string = 'default') {
    try {
      const response = await this.client.get(`/api/sessions/${sessionName}/qr`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get QR code: ${error.message}`);
    }
  }

  async getSessionStatus(sessionName: string = 'default') {
    try {
      const response = await this.client.get(`/api/sessions/${sessionName}`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get session status: ${error.message}`);
    }
  }

  async listSessions() {
    try {
      const response = await this.client.get('/api/sessions');
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to list sessions: ${error.message}`);
    }
  }

  // Messaging
  async sendTextMessage(sessionName: string, phoneNumber: string, text: string) {
    try {
      const response = await this.client.post(`/api/sendText`, {
        session: sessionName,
        chatId: `${phoneNumber}@c.us`,
        text: text,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to send text message: ${error.message}`);
    }
  }

  async sendImageMessage(
    sessionName: string,
    phoneNumber: string,
    imageUrl: string,
    caption?: string
  ) {
    try {
      const response = await this.client.post(`/api/sendImage`, {
        session: sessionName,
        chatId: `${phoneNumber}@c.us`,
        file: {
          url: imageUrl,
        },
        caption: caption,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to send image message: ${error.message}`);
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
        text: text,
        buttons: buttons,
      };

      if (imageUrl) {
        payload.footer = '';
        payload.image = { url: imageUrl };
      }

      const response = await this.client.post(`/api/sendButtons`, payload);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to send button message: ${error.message}`);
    }
  }

  // Untuk WAHA gratis, kita gunakan text dengan URL sebagai alternatif buttons
  async sendMessageWithButtons(
    sessionName: string,
    phoneNumber: string,
    message: string,
    imageUrl: string | null,
    buttons: Array<{ label: string; url: string }>
  ) {
    try {
      // Format pesan dengan buttons sebagai text
      let fullMessage = message + '\n\n';
      buttons.forEach((btn, index) => {
        fullMessage += `${index + 1}. ${btn.label}: ${btn.url}\n`;
      });

      if (imageUrl) {
        return await this.sendImageMessage(sessionName, phoneNumber, imageUrl, fullMessage);
      } else {
        return await this.sendTextMessage(sessionName, phoneNumber, fullMessage);
      }
    } catch (error: any) {
      throw new Error(`Failed to send message with buttons: ${error.message}`);
    }
  }
}

export default new WahaService();
