import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// Webhook from WAHA
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const { event, session, payload } = req.body;

    console.log('Webhook received:', { event, session, payload });

    // Handle session status updates
    if (event === 'session.status') {
      await prisma.session.updateMany({
        where: { sessionId: session },
        data: {
          status: payload.status,
        },
      });
    }

    // Handle message delivery status
    if (event === 'message.ack') {
      // Update message status based on ack
      const ackStatus = payload.ack;
      let status = 'sent';
      
      if (ackStatus === 2) status = 'delivered';
      if (ackStatus === 3) status = 'read';

      await prisma.message.updateMany({
        where: { waMessageId: payload.id },
        data: {
          status,
          deliveredAt: ackStatus >= 2 ? new Date() : undefined,
        },
      });
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
