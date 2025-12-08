// backend/src/routes/campaign.routes.ts

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import wahaService from '../services/waha.service';
import campaignQueue from '../services/queue.service';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// Helper type
type CampaignWithRelations = Awaited<ReturnType<typeof prisma.campaign.findUnique>>;

/* ===========================================================
    CREATE CAMPAIGN
=========================================================== */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, message, imageUrl, sessionId, buttons } = req.body;

    if (!name || !message || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Name, message & sessionId are required',
      });
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const campaign = await prisma.campaign.create({
      data: {
        name,
        message,
        imageUrl: imageUrl || null,
        sessionId,
      },
    });

    // Add up to 2 buttons
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
        _count: { select: { messages: true } },
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
    SEND CAMPAIGN (BATCHED 500)
=========================================================== */
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { contactIds } = req.body;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { buttons: true, session: true, messages: true },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (!Array.isArray(campaign.messages)) {
      return res.status(400).json({
        success: false,
        message: 'Campaign has no messages[]',
      });
    }

    const session = campaign.session;

    /* ---------- REFRESH WAHA SESSION ---------- */
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
      console.warn('[SEND] WAHA unreachable → using cached status');
    }

    const normalized = (session.status || '').toLowerCase();

    if (!['working', 'ready', 'authenticated'].includes(normalized)) {
      return res.status(400).json({
        success: false,
        message: `Session '${session.sessionId}' is not active. Current: ${session.status}`,
      });
    }

    /* ---------- LOAD CONTACTS ---------- */
    const where =
      contactIds && contactIds.length > 0
        ? { id: { in: contactIds } }
        : {};

    const contacts = await prisma.contact.findMany({ where });

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No contacts found',
      });
    }

    // Prepare message database entries
    await prisma.message.createMany({
      data: contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: 'pending',
      })),
    });

    await prisma.campaign.update({
      where: { id },
      data: {
        status: 'sending',
        totalContacts: contacts.length,
      },
    });

    /* =====================================================
        BATCH INTO GROUPS OF 500
    ===================================================== */
    const BATCH_SIZE = 500;
    const batches: any[] = [];

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      batches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    const btns = campaign.buttons.map((b) => ({
      label: b.label,
      url: b.url,
    }));

    // Create jobs per contact
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];

        await campaignQueue.add({
          campaignId: campaign.id,
          contactId: c.id,
          phoneNumber: c.phoneNumber,
          message: campaign.message,
          imageUrl: campaign.imageUrl,
          buttons: btns,
          sessionName: campaign.session.sessionId,
          messageIndex: i,
          batchIndex,
        });
      }
    }

    return res.json({
      success: true,
      message: `Campaign queued in ${batches.length} batches`,
      data: {
        totalContacts: contacts.length,
        totalBatches: batches.length,
      },
    });
  } catch (err: any) {
    console.error('[CAMPAIGN][SEND]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ===========================================================
    UPDATE CAMPAIGN
=========================================================== */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, message, imageUrl, buttons } = req.body;

    await prisma.campaign.update({
      where: { id: req.params.id },
      data: { name, message, imageUrl },
    });

    // Replace all buttons
    if (buttons) {
      await prisma.button.deleteMany({
        where: { campaignId: req.params.id },
      });

      await prisma.button.createMany({
        data: buttons.slice(0, 2).map((btn: any, i: number) => ({
          campaignId: req.params.id,
          label: btn.label,
          url: btn.url,
          order: i + 1,
        })),
      });
    }

    const updated = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: { buttons: true },
    });

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[CAMPAIGN][UPDATE]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ===========================================================
    DELETE CAMPAIGN
=========================================================== */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.campaign.delete({
      where: { id: req.params.id },
    });

    return res.json({
      success: true,
      message: 'Campaign deleted successfully',
    });
  } catch (err: any) {
    console.error('[CAMPAIGN][DELETE]', err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;
