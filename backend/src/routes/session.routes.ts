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

    // If session already exists in DB, return it directly
    const existing = await prisma.session.findFirst({ where: { sessionId: name } });
    if (existing) {
      return res.json({ success: true, data: existing });
    }

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
      let session;
      try {
        session = await prisma.session.create({
          data: {
            name,
            sessionId: name,
            status: 'failed',
            isDefault: true,
          },
        });
      } catch (dbErr: any) {
        // If already exists, return existing row
        session = await prisma.session.findFirst({ where: { sessionId: name } });
      }

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

    // Try WAHA QR endpoint first, supporting multiple formats
    try {
      const qrResp = await wahaService.getQRCode(session.sessionId);
      let dataUrl: string | null = null;
      if (qrResp.format === 'json') {
        const base64 = qrResp.data?.base64 || qrResp.data?.qr || qrResp.data?.image;
        if (base64) {
          dataUrl = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
        }
      } else if (qrResp.format === 'png') {
        dataUrl = qrResp.data;
      } else if (qrResp.format === 'raw') {
        // raw text value: render as QR via frontend component
        dataUrl = qrResp.data; // not a data URL, but store raw and let UI handle
      }

      if (dataUrl) {
        await prisma.session.update({ where: { id }, data: { qrCode: dataUrl } });
        return res.json({ success: true, data: { qr: dataUrl } });
      }
      console.warn('[SESSION][QR] QR endpoint returned no image/base64, falling back to screenshot');
    } catch (qrErr: any) {
      console.warn('[SESSION][QR] QR endpoint failed, trying screenshot...', qrErr.message);
    }

    // Fallback: use WAHA screenshot (base64 image)
    const shot = await wahaService.getSessionScreenshot(session.sessionId);
    // Attempt common shapes: { base64 }, { file: { base64 } }, raw png
    let base64: string | null = null;
    if (typeof shot === 'string') {
      base64 = shot;
    } else if (shot?.base64) {
      base64 = shot.base64;
    } else if (shot?.file?.base64) {
      base64 = shot.file.base64;
    }

    if (!base64) {
      return res.status(500).json({
        success: false,
        message: 'Screenshot did not contain base64 image',
      });
    }

    const dataUrl = base64.startsWith('data:')
      ? base64
      : `data:image/png;base64,${base64}`;

    await prisma.session.update({
      where: { id },
      data: { qrCode: dataUrl },
    });

    res.json({ success: true, data: { qr: dataUrl } });
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
