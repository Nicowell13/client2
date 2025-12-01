import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import sessionRoutes from './routes/session.routes';
import contactRoutes from './routes/contact.routes';
import campaignRoutes from './routes/campaign.routes';
import webhookRoutes from './routes/webhook.routes';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', message: 'WhatsApp API Backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/webhook', webhookRoutes);

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:${PORT}`);
});

export default app;
