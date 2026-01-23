// backend/src/routes/campaign.routes.ts

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import wahaService from '../services/waha.service';
import { getCampaignQueue } from '../services/queue.service';
import { authMiddleware } from '../middleware/auth';
import { executeAutoCampaigns } from '../services/auto-campaign.service';
import { recoverFailedCampaigns } from '../services/campaign-recovery.service';
import sessionRotation from '../services/session-rotation.service';
import { emitCampaignUpdate } from '../services/socket.service';

const router = Router();
router.use(authMiddleware);

/* ===========================================================
   CREATE CAMPAIGN
=========================================================== */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, message, messages, imageUrl, sessionId, buttons } = req.body;

    const cleanedMessages: string[] = Array.isArray(messages)
      ? messages
        .map((m: any) => String(m ?? '').trim())
        .filter((m: string) => m.length > 0)
      : [];

    const legacyMessage = String(message ?? '').trim();

    const finalMessage = cleanedMessages.length > 0 ? cleanedMessages[0] : legacyMessage;

    if (!name || !finalMessage || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Name, message and sessionId are required',
      });
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const campaign = await prisma.campaign.create({
      data: {
        name,
        // Persist multi-variant messages, but keep `message` as required fallback
        message: finalMessage,
        variants: cleanedMessages,
        imageUrl: imageUrl || null,
        sessionId,
      },
    });

    // Add buttons (max 2)
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
  } catch (error: any) {
    console.error('[CAMPAIGN][CREATE]', error);
    return res.status(500).json({ success: false, message: error.message });
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

    return res.json({
      success: true,
      data: campaigns,
    });
  } catch (error: any) {
    console.error('[CAMPAIGN][LIST]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===========================================================
   GET ALL MESSAGE LOGS (FOR MESSAGES PAGE)
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
  } catch (error: any) {
    console.error('[MESSAGES][LIST]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===========================================================
   SEND CAMPAIGN (WITH AUTO BATCH 500)
=========================================================== */
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { contactIds } = req.body;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: { buttons: true, session: true },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const variants: string[] = Array.isArray((campaign as any).variants) && (campaign as any).variants.length > 0
      ? ((campaign as any).variants as string[]).map((m) => String(m ?? '').trim()).filter((m) => m.length > 0)
      : [String(campaign.message ?? '').trim()].filter((m) => m.length > 0);

    if (variants.length === 0) {
      return res.status(400).json({ success: false, message: 'Campaign message is empty' });
    }

    const session = campaign.session;

    /* ---------------------------
       REFRESH SESSION STATUS
    ---------------------------- */
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
    } catch (e) {
      console.warn('[CAMPAIGN][STATUS] WAHA unreachable, using old status');
    }

    const normalized = (session.status || '').toLowerCase();

    if (!['working', 'ready', 'authenticated'].includes(normalized)) {
      return res.status(400).json({
        success: false,
        message: `Session '${session.sessionId}' is not active. Current: ${session.status}`,
      });
    }

    /* ---------------------------
       SMART SESSION SELECTION
       Jika session pilihan user sudah mencapai limit atau sedang istirahat,
       cari session alternatif yang masih available
    ---------------------------- */
    let activeSession = session;
    const sessionData = await prisma.session.findFirst({
      where: { id: session.id }
    });

    // Cek apakah session sudah limit atau sedang resting
    const isResting = (sessionData as any)?.jobLimitReached ||
      ((sessionData as any)?.restingUntil && new Date((sessionData as any).restingUntil) > new Date());

    if (isResting) {
      console.log(`[CAMPAIGN] Session ${session.name} sedang istirahat, mencari alternatif...`);

      const alternativeSession = await sessionRotation.getBestAvailableSession([session.id]);

      if (!alternativeSession) {
        return res.status(400).json({
          success: false,
          message: 'Semua session sedang istirahat atau tidak tersedia. Coba lagi nanti.',
        });
      }

      activeSession = alternativeSession;
      console.log(`[CAMPAIGN] Menggunakan session alternatif: ${activeSession.name}`);
    }

    /* ---------------------------
       GET CONTACTS
    ---------------------------- */
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

    // Save message placeholder rows
    await prisma.message.createMany({
      data: contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: 'pending',
      })),
    });

    /* ---------------------------
       UPDATE CAMPAIGN STATUS
    ---------------------------- */
    await prisma.campaign.update({
      where: { id },
      data: {
        status: 'sending',
        totalContacts: contacts.length,
      },
    });

    // Emit campaign update event
    emitCampaignUpdate({
      campaignId: id,
      status: 'sending',
      sentCount: 0,
      failedCount: 0,
      totalContacts: contacts.length,
    });

    /* ===========================================================
       >>>>>>>>>>>>> AUTO SPLIT INTO 500-SIZE BATCHES <<<<<<<<<<<<<
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

    // One queue/worker per session for parallel sending across sessions
    // Gunakan activeSession (hasil smart selection) bukan campaign.session
    const campaignQueue = getCampaignQueue(activeSession.sessionId);

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];

      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];

        // Sequential variant selection across all contacts with wrap-around
        const globalIndex = b * BATCH_SIZE + i;
        const selectedMessage = variants[globalIndex % variants.length];

        await campaignQueue.add({
          campaignId: campaign.id,
          contactId: c.id,
          phoneNumber: c.phoneNumber,
          message: selectedMessage,
          imageUrl: campaign.imageUrl,
          buttons: btns,
          sessionName: activeSession.sessionId, // WAHA SESSION NAME (dari smart selection)
          messageIndex: i,
          batchIndex: b,
        });
      }
    }

    /* ---------------------------
       RESPONSE
    ---------------------------- */
    return res.json({
      success: true,
      message: `Campaign queued successfully in ${batches.length} batches`,
      data: {
        totalContacts: contacts.length,
        totalBatches: batches.length,
      },
    });
  } catch (error: any) {
    console.error('[CAMPAIGN][SEND]', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to send campaign',
    });
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

    // Replace buttons
    if (buttons) {
      await prisma.button.deleteMany({ where: { campaignId: req.params.id } });

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
  } catch (error: any) {
    console.error('[CAMPAIGN][UPDATE]', error);
    return res.status(500).json({ success: false, message: error.message });
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
  } catch (error: any) {
    console.error('[CAMPAIGN][DELETE]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===========================================================
 AUTO EXECUTE CAMPAIGNS (WITH SESSION ROTATION)
=========================================================== */
router.post('/auto-execute', async (req: Request, res: Response) => {
  try {
    const { delayBetweenCampaigns } = req.body;

    const result = await executeAutoCampaigns({
      delayBetweenCampaigns: delayBetweenCampaigns
        ? Number(delayBetweenCampaigns)
        : undefined,
    });

    return res.json({
      success: result.success,
      message: result.message,
      data: {
        campaignsProcessed: result.campaignsProcessed,
        results: result.results || [],
      },
    });
  } catch (error: any) {
    console.error('[CAMPAIGN][AUTO-EXECUTE]', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to execute auto campaigns',
    });
  }
});

/* ===========================================================
 RECOVER FAILED CAMPAIGNS (REASSIGN TO ACTIVE SESSIONS)
=========================================================== */
router.post('/recover', async (_req: Request, res: Response) => {
  try {
    const result = await recoverFailedCampaigns();

    return res.json({
      success: result.success,
      message: result.success
        ? `Recovered ${result.campaignsRecovered} campaigns, reassigned ${result.messagesReassigned} messages`
        : 'Recovery failed - no active sessions available',
      data: {
        campaignsRecovered: result.campaignsRecovered,
        messagesReassigned: result.messagesReassigned,
        details: result.details,
      },
    });
  } catch (error: any) {
    console.error('[CAMPAIGN][RECOVER]', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to recover campaigns',
    });
  }
});

export default router;
