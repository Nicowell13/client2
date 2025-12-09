// backend/src/services/waha.service.ts
import axios, { AxiosInstance } from "axios";

export type QRFormat = "json" | "png" | "raw";

export interface QRResponse {
  format: QRFormat;
  data: any;
}

export interface ScreenshotResponse {
  format: "json" | "jpeg";
  data: any;
}

class WahaService {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.WAHA_URL || "http://localhost:3000";
    this.apiKey = process.env.WAHA_API_KEY || "";

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { "X-Api-Key": this.apiKey }),
        ...(this.apiKey && { "x-api-key": this.apiKey }),
      },
    });

    console.log("[WAHA] Base URL:", this.baseUrl, "| API key set:", !!this.apiKey);
  }

  // =====================================================================
  // SESSION MANAGEMENT
  // =====================================================================

  async startSession(sessionName: string = "default") {
    try {
      const response = await this.client.post("/api/sessions/start", {
        name: sessionName,
        config: {
          proxy: null,
          webhooks: [
            {
              url: `${process.env.BACKEND_URL || "http://backend:4000"}/webhook/whatsapp`,
              events: ["message", "session.status"],
            },
          ],
        },
      });

      return response.data;
    } catch (error: any) {
      console.error("[WAHA] Failed to start session:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async stopSession(sessionName: string = "default") {
    try {
      const response = await this.client.post("/api/sessions/stop", {
        name: sessionName,
      });

      return response.data;
    } catch (error: any) {
      console.error("[WAHA] Failed to stop session:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async getSessionStatus(sessionName: string = "default") {
    try {
      const res = await this.client.get(`/api/sessions/${encodeURIComponent(sessionName)}`);
      return res.data;
    } catch (error: any) {
      console.error("[WAHA] Failed to get session status:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async listSessions() {
    try {
      return (await this.client.get("/api/sessions")).data;
    } catch (error: any) {
      console.error("[WAHA] Failed to list sessions:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // =====================================================================
  // QR CODE HANDLING
  // =====================================================================

  async getQRCode(sessionName: string = "default"): Promise<QRResponse> {
    try {
      // JSON QR
      const jsonResp = await this.client.get(`/api/${sessionName}/auth/qr`, {
        headers: { accept: "application/json" },
        validateStatus: () => true,
      });

      if (jsonResp.status === 200) return { format: "json", data: jsonResp.data };

      // PNG QR
      const pngResp = await this.client.get(`/api/${sessionName}/auth/qr`, {
        headers: { accept: "image/png" },
        responseType: "arraybuffer",
        validateStatus: () => true,
      });

      if (pngResp.status === 200) {
        const base64 = Buffer.from(pngResp.data).toString("base64");
        return { format: "png", data: `data:image/png;base64,${base64}` };
      }

      throw new Error("QR endpoint returned non-200");
    } catch (error: any) {
      console.error("[WAHA][QR] FAILED:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async requestPairingCode(sessionName: string, phoneNumber: string) {
    try {
      const res = await this.client.post(
        `/api/${encodeURIComponent(sessionName)}/auth/request-code`,
        { phoneNumber }
      );

      return res.data;
    } catch (error: any) {
      console.error("[WAHA][PAIR] Failed:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // =====================================================================
  // SCREENSHOT
  // =====================================================================

  async getSessionScreenshot(sessionName: string = "default"): Promise<ScreenshotResponse> {
    const url = `/api/screenshot?session=${encodeURIComponent(sessionName)}`;

    try {
      const jsonResp = await this.client.get(url, {
        headers: { accept: "application/json" },
        responseType: "json",
        validateStatus: () => true,
      });

      if (jsonResp.status === 200) {
        return { format: "json", data: jsonResp.data };
      }

      const jpegResp = await this.client.get(url, {
        headers: { accept: "image/jpeg" },
        responseType: "arraybuffer",
        validateStatus: () => true,
      });

      if (jpegResp.status === 200) {
        const base64 = Buffer.from(jpegResp.data).toString("base64");
        return { format: "jpeg", data: `data:image/jpeg;base64,${base64}` };
      }

      throw new Error("Screenshot endpoint failed");
    } catch (error: any) {
      console.error("[WAHA][SCREENSHOT] FAILED:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // =====================================================================
  // BASIC MESSAGING
  // =====================================================================

  async sendTextMessage(sessionName: string, phoneNumber: string, text: string) {
    try {
      const res = await this.client.post("/api/sendText", {
        session: sessionName,
        chatId: `${phoneNumber}@c.us`,
        text,
      });

      return res.data;
    } catch (error: any) {
      console.error("[WAHA] sendText FAILED:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async sendImageMessage(
    sessionName: string,
    phoneNumber: string,
    imageUrl: string,
    caption?: string
  ) {
    try {
      const res = await this.client.post("/api/sendImage", {
        session: sessionName,
        chatId: `${phoneNumber}@c.us`,
        file: { url: imageUrl },
        caption,
      });

      return res.data;
    } catch (error: any) {
      console.error("[WAHA] sendImage FAILED:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // =====================================================================
  // WAHA PLUS — TRUE NATIVE INTERACTIVE BUTTONS (URL BUTTONS)
  // =====================================================================

  async sendButtonMessage(
    sessionName: string,
    phoneNumber: string,
    message: string,
    buttons: Array<{ label: string; url: string }>,
    imageUrl?: string
  ) {
    const payload: any = {
      session: sessionName,
      chatId: `${phoneNumber}@c.us`,

      header: "Informasi",
      body: message,
      footer: "Silakan pilih tombol 👇",

      buttons: buttons.map((b) => ({
        type: "url",
        text: b.label,
        url: b.url,
      })),
    };

    if (imageUrl) {
      payload.headerImage = {
        mimetype: "image/jpeg",
        filename: "image.jpg",
        url: imageUrl,
      };
    }

    try {
      const res = await this.client.post("/api/sendButtons", payload);
      return res.data;
    } catch (error: any) {
      console.error("[WAHA PLUS] sendButtons FAILED:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // =====================================================================
  // UNIVERSAL — USED BY QUEUE / CAMPAIGN (AUTO FALLBACK)
  // =====================================================================

  async sendMessageWithButtons(
    sessionName: string,
    phoneNumber: string,
    message: string,
    imageUrl: string | null,
    buttons: Array<{ label: string; url: string }>
  ) {
    // 1) Coba native WAHA PLUS dulu
    try {
      return await this.sendButtonMessage(
        sessionName,
        phoneNumber,
        message,
        buttons,
        imageUrl || undefined
      );
    } catch (error) {
      console.warn("[WAHA] Native buttons unsupported → fallback to text.");
    }

    // 2) FALLBACK WAHA FREE — buttons jadi teks
    let full = message + "\n\n";
    buttons.forEach((b, i) => {
      full += `${i + 1}. ${b.label}: ${b.url}\n`;
    });

    if (imageUrl) return this.sendImageMessage(sessionName, phoneNumber, imageUrl, full);
    return this.sendTextMessage(sessionName, phoneNumber, full);
  }
}

export default new WahaService();
