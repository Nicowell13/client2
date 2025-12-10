// backend/src/routes/campaign.routes.ts

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import wahaService from '../services/waha.service';
import campaignQueue from '../services/queue.service';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

/* ===========================================================
  CREATE CAMPAIGN — supports messages[] (frontend) → variants[] (DB)
=========================================================== */
router.post('/', async (req: Request, res: Response) => {
  try {
  const { name, messages, imageUrl, sessionId, buttons } = req.body;

    if (!name || !sessionId)
      return res.status(400).json({ success: false, message: 'Name & sessionId are required' });

    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ success: false, message: 'messages[] must contain ≥1 message' });

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session)
      return res.status(404).json({ success: false, message: 'Session not found' });

    const campaign = await prisma.campaign.create({
      data: {
        name,
        // Legacy schema: store the first message only
        message: messages[0] || '',
        imageUrl: imageUrl || null,
        sessionId,
      },
    });

    // Insert up to 2 buttons
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
    SEND CAMPAIGN — RANDOM MESSAGE VARIANT
=========================================================== */
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { buttons: true, session: true },
    });

    if (!campaign)
      return res.status(404).json({ success: false, message: 'Campaign not found' });

    // Build message variants: use `variants` when present, otherwise fallback to legacy `message`
    const variants: string[] = campaign?.message ? [campaign.message] : [];

    if (!Array.isArray(variants) || variants.length === 0)
      return res.status(400).json({ success: false, message: 'Campaign has no message variants' });

    const session = campaign.session;

    // Refresh WAHA status
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
      console.warn('[SEND] WAHA unreachable — using cached status');
    }

    if (!['working', 'ready', 'authenticated'].includes(session.status.toLowerCase()))
      return res.status(400).json({
        success: false,
        message: `Session '${session.sessionId}' is not active (status: ${session.status})`,
      });

    // Load contacts
    const contacts = await prisma.contact.findMany();
    if (contacts.length === 0)
      return res.status(400).json({ success: false, message: 'No contacts found' });

    // Log message records
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

    // Batch into groups of 500
    const BATCH_SIZE = 500;
    const batches = [];
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    const btns = campaign.buttons.map((b) => ({ label: b.label, url: b.url }));

    // Push queue jobs
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      for (let i = 0; i < batch.length; i++) {
        const contact = batch[i];

        await campaignQueue.add({
          campaignId: campaign.id,
          contactId: contact.id,
          phoneNumber: contact.phoneNumber,
          messages: variants,       // ALL VARIANTS
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
    return res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (err: any) {
    console.error('[CAMPAIGN][DELETE]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ===========================================================
    GET ALL MESSAGES (for real-time tracking)
=========================================================== */
router.get('/messages/all', async (_req: Request, res: Response) => {
  try {
    const messages = await prisma.message.findMany({
      include: {
        contact: {
          select: {
            name: true,
            phoneNumber: true,
          },
        },
        campaign: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, data: messages });
  } catch (err: any) {
    console.error('[MESSAGES][LIST]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
