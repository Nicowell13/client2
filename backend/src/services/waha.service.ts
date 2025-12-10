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

    console.log("[WAHA] Base URL:", this.baseUrl, "| API key:", !!this.apiKey);
  }

  // =====================================================================
  // SESSION MANAGEMENT
  // =====================================================================

  async startSession(sessionName: string = "default") {
    try {
      const res = await this.client.post("/api/sessions/start", {
        name: sessionName,
        config: {
          proxy: null,
          webhooks: [
            {
              url: `${process.env.BACKEND_URL}/webhook/whatsapp`,
              events: ["message", "session.status"],
            },
          ],
        },
      });
      return res.data;
    } catch (e: any) {
      console.error("[WAHA] startSession FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  async stopSession(sessionName: string = "default") {
    try {
      const res = await this.client.post("/api/sessions/stop", { name: sessionName });
      return res.data;
    } catch (e: any) {
      console.error("[WAHA] stopSession FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  async getSessionStatus(sessionName: string = "default") {
    try {
      return (await this.client.get(`/api/sessions/${sessionName}`)).data;
    } catch (e: any) {
      console.error("[WAHA] getSessionStatus FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  async listSessions() {
    try {
      return (await this.client.get("/api/sessions")).data;
    } catch (e: any) {
      console.error("[WAHA] listSessions FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  // =====================================================================
  // QR CODE HANDLING
  // =====================================================================

  async getQRCode(sessionName: string = "default"): Promise<QRResponse> {
    try {
      const jsonResp = await this.client.get(`/api/${sessionName}/auth/qr`, {
        headers: { accept: "application/json" },
        validateStatus: () => true,
      });

      if (jsonResp.status === 200) return { format: "json", data: jsonResp.data };

      return { format: "raw", data: null };
    } catch (e: any) {
      console.error("[WAHA][QR] FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  async requestPairingCode(sessionName: string, phoneNumber: string) {
    try {
      const res = await this.client.post(
        `/api/${encodeURIComponent(sessionName)}/auth/request-code`,
        { phoneNumber }
      );
      return res.data;
    } catch (e: any) {
      console.error("[WAHA][PAIR] FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  // =====================================================================
  // SCREENSHOT
  // =====================================================================

  async getSessionScreenshot(sessionName: string = "default"): Promise<ScreenshotResponse> {
    const url = `/api/screenshot?session=${encodeURIComponent(sessionName)}`;

    try {
      // JSON first (base64)
      const jsonResp = await this.client.get(url, {
        headers: { accept: "application/json" },
        responseType: "json",
        validateStatus: () => true,
      });

      if (jsonResp.status === 200) {
        return { format: "json", data: jsonResp.data };
      }

      // JPEG fallback
      const jpegResp = await this.client.get(url, {
        headers: { accept: "image/jpeg" },
        responseType: "arraybuffer",
        validateStatus: () => true,
      });

      if (jpegResp.status === 200) {
        const base64 = Buffer.from(jpegResp.data).toString("base64");
        return { format: "jpeg", data: `data:image/jpeg;base64,${base64}` };
      }

      throw new Error("Screenshot endpoint returned non-200");
    } catch (e: any) {
      console.error("[WAHA][SCREENSHOT] FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  // =====================================================================
  // BASIC MESSAGES
  // =====================================================================

  async sendTextMessage(sessionName: string, phoneNumber: string, text: string) {
    try {
      return (
        await this.client.post("/api/sendText", {
          session: sessionName,
          phone: phoneNumber, // FIX for WebJS
          text,
        })
      ).data;
    } catch (e: any) {
      console.error("[WAHA] sendText FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  async sendImageMessage(
    sessionName: string,
    phoneNumber: string,
    imageUrl: string,
    caption?: string
  ) {
    try {
      return (
        await this.client.post("/api/sendImage", {
          session: sessionName,
          phone: phoneNumber, // FIX for WebJS
          file: { url: imageUrl },
          caption,
        })
      ).data;
    } catch (e: any) {
      console.error("[WAHA] sendImage FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  // =====================================================================
  // WEBJS TEMPLATE BUTTONS (NATIVE)
  // =====================================================================

  async sendButtonTemplate({
    session,
    phoneNumber,
    header,
    headerImage,
    body,
    footer,
    buttons,
  }: {
    session: string;
    phoneNumber: string;
    header: string;
    headerImage?: any;
    body: string;
    footer: string;
    buttons: Array<{ type: string; text: string; url?: string }>;
  }) {
    const payload: any = {
      session,
      phone: phoneNumber, // FIX
      header,
      body,
      footer,
      buttons,
    };

    if (headerImage) payload.headerImage = headerImage;

    try {
      return (await this.client.post("/api/sendButtons", payload)).data;
    } catch (e: any) {
      console.error("[WAHA] sendButtonTemplate FAILED:", e?.response?.data || e.message);
      throw e;
    }
  }

  // =====================================================================
  // UNIVERSAL BUTTON-SENDER FOR CAMPAIGNS / QUEUE
  // =====================================================================

  async sendMessageWithButtons(
    sessionName: string,
    phoneNumber: string,
    message: string,
    imageUrl: string | null,
    buttons: Array<{ label: string; url: string }>
  ) {
    const payloadButtons = buttons.map((b) => ({
      type: "url",
      text: b.label,
      url: b.url,
    }));

    try {
      return await this.sendButtonTemplate({
        session: sessionName,
        phoneNumber,
        header: "Informasi",
        headerImage: imageUrl
          ? {
              mimetype: "image/jpeg",
              filename: "header.jpg",
              url: imageUrl,
            }
          : undefined,
        body: message,
        footer: "Silakan pilih tombol 👇",
        buttons: payloadButtons,
      });
    } catch (e) {
      console.warn("[WAHA] Template button failed → fallback text mode.");

      let full = message + "\n\n";
      buttons.forEach((b, i) => (full += `${i + 1}. ${b.label}: ${b.url}\n`));

      if (imageUrl) {
        return this.sendImageMessage(sessionName, phoneNumber, imageUrl, full);
      }
      return this.sendTextMessage(sessionName, phoneNumber, full);
    }
  }
}

export default new WahaService();
