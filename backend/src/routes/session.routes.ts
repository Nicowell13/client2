import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import wahaService from '../services/waha.service';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Protect all session routes
router.use(authMiddleware);

// Create new session
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name = 'default' } = req.body;

    console.log(`[SESSION] Creating session: ${name}`);

    // Start session with WAHA
    try {
      const wahaSession = await wahaService.startSession(name);
      console.log(`[SESSION] WAHA response:`, wahaSession);

      // Save to database
      const session = await prisma.session.create({
        data: {
          name,
          sessionId: wahaSession.name || name,
          status: 'starting',
          isDefault: true,
        },
      });

      console.log(`[SESSION] Session created in DB:`, session.id);

      res.json({
        success: true,
        data: session,
      });
    } catch (wahaError: any) {
      console.error(`[SESSION] WAHA error:`, wahaError.message);
      
      // Try to create session in DB even if WAHA fails (for retry later)
      const session = await prisma.session.create({
        data: {
          name,
          sessionId: name,
          status: 'failed',
          isDefault: true,
        },
      });

      res.status(500).json({
        success: false,
        message: `Failed to start WhatsApp session: ${wahaError.message}. Session saved for manual retry.`,
        data: session,
      });
    }
  } catch (error: any) {
    console.error(`[SESSION] Unexpected error:`, error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create session',
    });
  }
});

// Get all sessions
router.get('/', async (req: Request, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get session by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    // Get status from WAHA
    try {
      const wahaStatus = await wahaService.getSessionStatus(session.sessionId);
      
      // Update status in database
      await prisma.session.update({
        where: { id },
        data: {
          status: wahaStatus.status,
          phoneNumber: wahaStatus.me?.id || session.phoneNumber,
        },
      });

      session.status = wahaStatus.status;
    } catch (error) {
      console.error('Failed to get WAHA status:', error);
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get QR Code
router.get('/:id/qr', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    const qrData = await wahaService.getQRCode(session.sessionId);

    // Update QR code in database
    await prisma.session.update({
      where: { id },
      data: {
        qrCode: qrData.qr || null,
      },
    });

    res.json({
      success: true,
      data: qrData,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Stop session
router.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    await wahaService.stopSession(session.sessionId);

    await prisma.session.update({
      where: { id },
      data: {
        status: 'stopped',
      },
    });

    res.json({
      success: true,
      message: 'Session stopped successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Delete session
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.session.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Session deleted successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
