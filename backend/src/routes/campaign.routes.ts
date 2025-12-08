// backend/src/routes/campaign.routes.ts

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import wahaService from '../services/waha.service';
import campaignQueue from '../services/queue.service';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

/* ===========================================================
    CREATE CAMPAIGN — supports messages[]
=========================================================== */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, messages, imageUrl, sessionId, buttons } = req.body;

    if (!name || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Name & sessionId are required',
      });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'messages[] must contain at least 1 message',
      });
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        name,
        messages,
        message: messages[0], // fallback for compatibility
        imageUrl: imageUrl || null,
        sessionId,
      },
    });

    // Add optional button(s)
    if (Array.isArray(buttons) && buttons.length > 0) {
      await prisma.button.createMany({
        data: buttons.slice(0, 2).map((btn: any, i: number) => ({
          campaignId: campaign.id,
          label: btn.label,
          url: btn.url,
          order: i + 1,
        })),
      });
    }

    const result = await prisma.campaign.findUnique({
      where: { id: campaign.id },
      include: { buttons: true },
    });

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[CAMPAIGN][CREATE]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ===========================================================
    GET ALL CAMPAIGNS
=========================================================== */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        buttons: true,
        session: true,
        _count: { select: { messages: true } }, // count logs
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, data: campaigns });
  } catch (err: any) {
    console.error('[CAMPAIGN][LIST]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ===========================================================
    SEND CAMPAIGN — RANDOM VARIANT MESSAGE
=========================================================== */
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { buttons: true, session: true },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (!Array.isArray(campaign.messages) || campaign.messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Campaign has no messages[] variants',
      });
    }

    const session = campaign.session;

    // Refresh WAHA session status
    try {
      const status = await wahaService.getSessionStatus(session.sessionId);
      await prisma.session.update({
        where: { id: session.id },
        data: {
          status: status?.status || session.status,
          phoneNumber: status?.me?.id || session.phoneNumber,
        },
      });
      session.status = status?.status || session.status;
    } catch {
      console.warn('[SEND] WAHA unreachable – using cached status');
    }

    if (!['working', 'ready', 'authenticated'].includes(session.status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Session '${session.sessionId}' is not active`,
      });
    }

    // Load contacts
    const contacts = await prisma.contact.findMany();
    if (contacts.length === 0) {
      return res.status(400).json({ success: false, message: 'No contacts found' });
    }

    // Create logs
    await prisma.message.createMany({
      data: contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: 'pending',
      })),
    });

    await prisma.campaign.update({
      where: { id },
      data: { status: 'sending', totalContacts: contacts.length },
    });

    /* ===========================================================
        Batch into chunks of 500
    ============================================================ */
    const BATCH_SIZE = 500;
    const batches = [];
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    const btns = campaign.buttons.map((b) => ({
      label: b.label,
      url: b.url,
    }));

    // Random message picker
    const pickRandom = (arr: string[]) =>
      arr[Math.floor(Math.random() * arr.length)];

    // Queue jobs
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      for (let i = 0; i < batch.length; i++) {
        const contact = batch[i];

        await campaignQueue.add({
          campaignId: campaign.id,
          contactId: contact.id,
          phoneNumber: contact.phoneNumber,
          message: pickRandom(campaign.messages), // RANDOM variant
          imageUrl: campaign.imageUrl,
          buttons: btns,
          sessionName: session.sessionId,
          messageIndex: i,
          batchIndex,
        });
      }
    }

    return res.json({
      success: true,
      message: `Campaign queued in ${batches.length} batches`,
    });
  } catch (err: any) {
    console.error('[CAMPAIGN][SEND]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ===========================================================
    DELETE CAMPAIGN
=========================================================== */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.campaign.delete({ where: { id: req.params.id } });
    return res.json({
      success: true,
      message: 'Campaign deleted successfully',
    });
  } catch (err: any) {
    console.error('[CAMPAIGN][DELETE]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
