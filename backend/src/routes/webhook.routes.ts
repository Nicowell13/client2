import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// Webhook from WAHA
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;

    // 🛑 SILENTLY IGNORE INCOMING MESSAGES to save resources
    // These events are heavy and coming from group chats
    if (event === 'message' || event === 'message.any') {
      return res.json({ success: true });
    }

    console.log('Webhook received:', { event, session, payload });

    // Handle session status updates
    if (event === 'session.status') {
      // Attempt to extract QR code from payload variants
      let qr: string | null = null;
      if (payload) {
        qr = payload.qr || payload.qrCode || null;
        if (!qr && Array.isArray(payload.statuses)) {
          for (const st of payload.statuses) {
            if (st && (st.qr || st.qrCode)) {
              qr = st.qr || st.qrCode;
              break;
            }
          }
        }
      }

      const updateData: any = { status: payload.status };
      if (qr) {
        updateData.qrCode = qr;
        console.log('[Webhook][QR] Captured QR code for session', session);
      }

      await prisma.session.updateMany({
        where: { sessionId: session },
        data: updateData,
      });
    }

    // Handle message delivery status
    if (event === 'message.ack') {
      const ackStatus = payload.ack;
      let status: string | undefined;
      let isError = false;

      if (ackStatus === -1) {
        status = 'failed';
        isError = true;
      } else if (ackStatus === 2) {
        status = 'delivered';
      } else if (ackStatus === 3) {
        status = 'read';
      }

      if (status) {
        // Find the message first to know which campaign to update
        const msgRecord = await prisma.message.findFirst({
          where: { waMessageId: payload.id },
          select: { id: true, campaignId: true, status: true }
        });

        if (msgRecord) {
          await prisma.message.update({
            where: { id: msgRecord.id },
            data: {
              status,
              deliveredAt: ackStatus >= 2 ? new Date() : undefined,
              errorMsg: isError ? `WhatsApp Error (ack: -1)` : undefined
            },
          });

          // Update campaign stats if it transitioned to failed from something else
          if (isError && msgRecord.status !== 'failed') {
            try {
              await prisma.campaign.update({
                where: { id: msgRecord.campaignId },
                data: {
                  failedCount: { increment: 1 },
                  sentCount: { decrement: 1 }
                }
              });
            } catch (statsError) {
              console.warn('[Webhook] Failed to update campaign stats:', statsError);
            }
          }
        }
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
