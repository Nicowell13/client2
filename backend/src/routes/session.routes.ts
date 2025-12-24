// backend/src/routes/session.routes.ts
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

    console.log('[SESSION] Creating session:', name);

    // Allow custom session names, but limit to max 3 active records
    const totalSessions = await prisma.session.count();
    if (totalSessions >= 3) {
      return res.status(400).json({
        success: false,
        message: 'Maksimal 3 sesi aktif. Silakan hubungi admin untuk menambah sesi.',
      });
    }

    const existing = await prisma.session.findFirst({ where: { sessionId: name } });
    if (existing) {
      return res.json({ success: true, data: existing });
    }

    try {
      const wahaSession = await wahaService.startSession(name);
      console.log('[SESSION] WAHA response:', wahaSession);

      const session = await prisma.session.create({
        data: {
          name,
          sessionId:
            (wahaSession && (wahaSession.name || wahaSession.session || wahaSession.sessionId)) ||
            name,
          status: 'starting',
          isDefault: true,
        },
      });

      console.log('[SESSION] Session created in DB:', session.id);

      return res.json({
        success: true,
        data: session,
      });
    } catch (wahaError: any) {
      console.error('[SESSION] WAHA error:', wahaError?.message || wahaError);

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
        session = await prisma.session.findFirst({ where: { sessionId: name } });
      }

      return res.status(500).json({
        success: false,
        message: `Failed to start WhatsApp session: ${
          wahaError?.message || 'Unknown error'
        }. Session saved for manual retry.`,
        data: session,
      });
    }
  } catch (error: any) {
    console.error('[SESSION] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to create session',
    });
  }
});

// Get all sessions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const sessions = await prisma.session.findMany({ orderBy: { createdAt: 'desc' } });

    const refreshed = await Promise.all(
      sessions.map(async (s) => {
        try {
          const status = await wahaService.getSessionStatus(s.sessionId);
          const updated = await prisma.session.update({
            where: { id: s.id },
            data: {
              status: status?.status || s.status,
              phoneNumber: status?.me?.id || s.phoneNumber,
            },
          });
          return updated;
        } catch (_err) {
          return s;
        }
      })
    );

    return res.json({ success: true, data: refreshed });
  } catch (error: any) {
    console.error('[SESSION] Failed to list sessions:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to get sessions',
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

    try {
      const wahaStatus = await wahaService.getSessionStatus(session.sessionId);

      await prisma.session.update({
        where: { id },
        data: {
          status: wahaStatus?.status || session.status,
          phoneNumber: wahaStatus?.me?.id || session.phoneNumber,
        },
      });

      session.status = wahaStatus?.status || session.status;
    } catch (err: any) {
      console.error('[SESSION] Failed to get WAHA status:', err?.message || err);
    }

    return res.json({
      success: true,
      data: session,
    });
  } catch (error: any) {
    console.error('[SESSION] Failed to get session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to get session',
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

    // 1) Coba QR endpoint
    try {
      const qrResp = await wahaService.getQRCode(session.sessionId);
      let dataUrl: string | null = null;

      if (qrResp.format === 'json') {
        const base64 =
          qrResp.data?.base64 || qrResp.data?.qr || qrResp.data?.image;
        if (base64) {
          dataUrl = base64.startsWith('data:')
            ? base64
            : `data:image/png;base64,${base64}`;
        }
      } else if (qrResp.format === 'png') {
        dataUrl = qrResp.data;
      } else if (qrResp.format === 'raw') {
        // raw text, dikirim apa adanya; frontend yang render
        dataUrl = qrResp.data;
      }

      if (dataUrl) {
        await prisma.session.update({ where: { id }, data: { qrCode: dataUrl } });
        return res.json({ success: true, data: { qr: dataUrl } });
      }

      console.warn('[SESSION][QR] WAHA QR empty, fallback to screenshot');
    } catch (err: any) {
      console.warn('[SESSION][QR] WAHA QR failed → screenshot fallback:', err?.message || err);
    }

    // 2) Screenshot fallback
    const shot = await wahaService.getSessionScreenshot(session.sessionId);
    let dataUrl: string | null = null;

    if (shot.format === 'jpeg') {
      dataUrl = shot.data; // sudah data URL
    } else if (shot.format === 'json') {
      const base64 =
        shot.data?.base64 || shot.data?.file?.base64 || null;
      if (base64) {
        dataUrl = base64.startsWith('data:')
          ? base64
          : `data:image/jpeg;base64,${base64}`;
      }
    }

    if (!dataUrl) {
      return res
        .status(500)
        .json({ success: false, message: 'Screenshot did not contain image' });
    }

    await prisma.session.update({ where: { id }, data: { qrCode: dataUrl } });
    return res.json({ success: true, data: { qr: dataUrl } });
  } catch (error: any) {
    console.error('[SESSION][QR] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to get QR code',
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

    return res.json({
      success: true,
      message: 'Session stopped successfully',
    });
  } catch (error: any) {
    console.error('[SESSION] Failed to stop session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to stop session',
    });
  }
});

// Delete session
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Cleanup in WAHA to avoid leaving residue that can affect next sessions
    try {
      await wahaService.stopSession(session.sessionId);
    } catch (e: any) {
      console.warn('[SESSION][DELETE] WAHA stop failed (continuing):', e?.message || e);
    }

    try {
      await wahaService.logoutSession(session.sessionId);
    } catch (e: any) {
      console.warn('[SESSION][DELETE] WAHA logout failed (continuing):', e?.message || e);
    }

    try {
      await wahaService.deleteSession(session.sessionId);
    } catch (e: any) {
      console.error('[SESSION][DELETE] WAHA delete failed (aborting DB delete):', e?.message || e);
      return res.status(502).json({
        success: false,
        message: `Failed to delete session in WAHA: ${e?.message || 'Unknown error'}`,
      });
    }

    await prisma.session.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: 'Session deleted successfully',
    });
  } catch (error: any) {
    console.error('[SESSION] Failed to delete session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to delete session',
    });
  }
});

// Request pairing code
router.post('/:id/request-code', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res
        .status(400)
        .json({ success: false, message: 'phoneNumber is required' });
    }

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return res
        .status(404)
        .json({ success: false, message: 'Session not found' });
    }

    const resp = await wahaService.requestPairingCode(
      session.sessionId,
      phoneNumber
    );

    return res.json({ success: true, data: resp });
  } catch (error: any) {
    console.error('[SESSION][PAIR] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to request pairing code',
    });
  }
});

export default router;
