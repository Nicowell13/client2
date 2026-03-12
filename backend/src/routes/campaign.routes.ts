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
   SEND CAMPAIGN — 🚀 NINJA BURST MODE (Promise.all direct fire)
   Bypasses Bull Queue entirely. All sock.sendMessage() calls
   fire in a SINGLE event loop tick via Promise.all().
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
      console.warn('[CAMPAIGN][STATUS] Baileys status check failed, using cached status');
    }

    const normalized = (session.status || '').toLowerCase();
    if (!['working', 'ready', 'authenticated'].includes(normalized)) {
      return res.status(400).json({
        success: false,
        message: `Session '${session.sessionId}' is not active. Current: ${session.status}`,
      });
    }

    /* ---------------------------
       GET CONTACTS
    ---------------------------- */
    const where = contactIds && contactIds.length > 0 ? { id: { in: contactIds } } : {};
    const contacts = await prisma.contact.findMany({ where });

    if (contacts.length === 0) {
      return res.status(400).json({ success: false, message: 'No contacts found' });
    }

    // Save message placeholder rows
    await prisma.message.createMany({
      data: contacts.map((c) => ({
        campaignId: campaign.id,
        contactId: c.id,
        status: 'pending',
      })),
    });

    // Update campaign status
    await prisma.campaign.update({
      where: { id },
      data: { status: 'sending', totalContacts: contacts.length },
    });

    emitCampaignUpdate({
      campaignId: id,
      status: 'sending',
      sentCount: 0,
      failedCount: 0,
      totalContacts: contacts.length,
    });

    /* ===========================================================
       🚀🚀🚀 NINJA BURST: DIRECT Promise.all() — NO BULL QUEUE 🚀🚀🚀
       All messages fire through the WebSocket at the EXACT same
       millisecond. This replicates Ninja WA Sender behavior.
    ============================================================ */

    const healthySessions = await sessionRotation.getAllHealthySessions();
    if (healthySessions.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada session yang available.' });
    }

    const BURST_SIZE = Number(process.env.GLOBAL_SEND_CONCURRENCY || 200);
    console.log(`🚀 [NINJA-BURST] Firing ${contacts.length} messages via Promise.all() (burst size: ${BURST_SIZE})`);
    console.log(`🚀 [NINJA-BURST] Sessions: ${healthySessions.map(s => s.name).join(', ')}`);

    const btns = campaign.buttons.map((b) => ({ label: b.label, url: b.url }));

    // Respond immediately — sending happens in background
    res.json({
      success: true,
      message: `🚀 NINJA BURST: ${contacts.length} messages firing simultaneously!`,
      data: {
        totalContacts: contacts.length,
        totalSessions: healthySessions.length,
        burstSize: BURST_SIZE,
      },
    });

    // ===============================
    // BACKGROUND: Fire all messages in batches of BURST_SIZE
    // Each batch uses Promise.all() for TRUE simultaneous sending
    // ===============================
    (async () => {
      let sentCount = 0;
      let failedCount = 0;

      for (let batchStart = 0; batchStart < contacts.length; batchStart += BURST_SIZE) {
        const batch = contacts.slice(batchStart, batchStart + BURST_SIZE);

        console.log(`🚀 [NINJA-BURST] Firing batch ${Math.floor(batchStart / BURST_SIZE) + 1}: ${batch.length} messages simultaneously`);

        // 🔥 THE KEY: Promise.all() fires ALL sendMessage() calls in ONE event loop tick
        const results = await Promise.allSettled(
          batch.map(async (contact, idx) => {
            const globalIndex = batchStart + idx;
            const selectedMessage = variants[globalIndex % variants.length];
            const selectedSession = healthySessions[globalIndex % healthySessions.length];

            try {
              // Process message template
              let finalMessage = selectedMessage
                .replace(/\{name\}/gi, contact.name || '')
                .replace(/\{phone\}/gi, contact.phoneNumber || '');

              // 🚀 DIRECT SOCKET SEND — no queue, no delay, no DB check before send
              const result = await wahaService.sendMessageWithButtons(
                selectedSession.sessionId,
                contact.phoneNumber,
                finalMessage,
                campaign.imageUrl,
                btns
              );

              const waMessageId = result?.id || null;

              // Mark as sent (async, doesn't block next send)
              await prisma.message.updateMany({
                where: { campaignId: campaign.id, contactId: contact.id, status: 'pending' },
                data: { status: 'sent', waMessageId, sentAt: new Date() },
              });

              sentCount++;
              return { success: true, contactId: contact.id };
            } catch (err: any) {
              await prisma.message.updateMany({
                where: { campaignId: campaign.id, contactId: contact.id, status: 'pending' },
                data: { status: 'failed', errorMsg: (err?.message || 'Unknown error').substring(0, 200) },
              });
              failedCount++;
              return { success: false, contactId: contact.id, error: err?.message };
            }
          })
        );

        // Update campaign stats after each burst batch
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { sentCount, failedCount },
        });

        emitCampaignUpdate({
          campaignId: campaign.id,
          status: 'sending',
          sentCount,
          failedCount,
          totalContacts: contacts.length,
        });

        console.log(`✅ [NINJA-BURST] Batch done: ${sentCount} sent, ${failedCount} failed`);
      }

      // Mark campaign as completed
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: 'sent' },
      });

      emitCampaignUpdate({
        campaignId: campaign.id,
        status: 'sent',
        sentCount,
        failedCount,
        totalContacts: contacts.length,
      });

      console.log(`🎉 [NINJA-BURST] Campaign ${campaign.id} COMPLETE: ${sentCount} sent, ${failedCount} failed out of ${contacts.length}`);
    })().catch(err => {
      console.error(`❌ [NINJA-BURST] Fatal error:`, err);
    });

    return;
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
    return res.json({ success: true, message: 'Campaign deleted successfully' });
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
      delayBetweenCampaigns: delayBetweenCampaigns ? Number(delayBetweenCampaigns) : undefined,
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
    return res.status(500).json({ success: false, message: error.message || 'Failed to execute auto campaigns' });
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
    return res.status(500).json({ success: false, message: error.message || 'Failed to recover campaigns' });
  }
});

/* ===========================================================
 CLEAR STUCK QUEUE (EMERGENCY RESET)
=========================================================== */
router.post('/clear-queue', async (_req: Request, res: Response) => {
  try {
    const campaignQueue = getCampaignQueue('global');
    const waiting = await campaignQueue.getWaitingCount();
    const active = await campaignQueue.getActiveCount();
    const delayed = await campaignQueue.getDelayedCount();
    const failed = await campaignQueue.getFailedCount();

    console.log(`[QUEUE] Before clear: waiting=${waiting}, active=${active}, delayed=${delayed}, failed=${failed}`);

    await campaignQueue.empty();
    await campaignQueue.clean(0, 'delayed');
    await campaignQueue.clean(0, 'wait');
    await campaignQueue.clean(0, 'active');
    await campaignQueue.clean(0, 'completed');
    await campaignQueue.clean(0, 'failed');

    console.log('[QUEUE] Queue cleared successfully');

    return res.json({
      success: true,
      message: 'Queue cleared successfully',
      data: { clearedJobs: { waiting, active, delayed, failed } },
    });
  } catch (error: any) {
    console.error('[QUEUE][CLEAR]', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to clear queue' });
  }
});

export default router;
