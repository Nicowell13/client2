import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Routes
import authRoutes from './routes/auth.routes';
import sessionRoutes from './routes/session.routes';
import contactRoutes from './routes/contact.routes';
import campaignRoutes from './routes/campaign.routes';
import webhookRoutes from './routes/webhook.routes';
import uploadRoutes from './routes/upload.routes';

// Middleware
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 4000;

// ====== CORS CONFIG (SAFE FOR NEXT.JS) ======
app.use(cors({
  origin: "*",  // boleh diganti domain production nanti
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type, Authorization, X-Api-Key, x-api-key",
}));

// ====== BODY PARSER (IMPORTANT: LIMIT BIG PAYLOAD) ======
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ====== STATIC FILES (FOR UPLOADED IMAGES) ======
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ====== HEALTH CHECK ======
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'OK',
    message: 'WhatsApp API Backend is running',
    version: '1.0.0',
  });
});

// ====== API ROUTES ======
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/upload', uploadRoutes);

// Webhook harus diterima RAW untuk WAHA event
// Atur sebelum errorHandler supaya tidak ditangkap sebagai error
app.use('/webhook', webhookRoutes);

// ====== ERROR HANDLER (LAST MIDDLEWARE) ======
app.use(errorHandler);

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`⚡️ [server] Backend running at http://localhost:${PORT}`);
  console.log(`🌐 Using WAHA_URL = ${process.env.WAHA_URL}`);
  console.log(`🔑 API Key set: ${!!process.env.WAHA_API_KEY}`);
});

export default app;
