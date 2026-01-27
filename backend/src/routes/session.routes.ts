// backend/src/routes/session.routes.ts
import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import wahaService from '../services/waha.service';
import { authMiddleware } from '../middleware/auth';
import { emitSessionUpdate } from '../services/socket.service';

const router = Router();
const MAX_SESSIONS = 5;

// Protect all session routes
router.use(authMiddleware);

// Create new session
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name = 'default' } = req.body;

    console.log('[SESSION] Creating session:', name);

    // Allow custom session names, but limit to max active records
    const totalSessions = await prisma.session.count();
    if (totalSessions >= MAX_SESSIONS) {
      return res.status(400).json({
        success: false,
        message: `Maksimal ${MAX_SESSIONS} sesi aktif. Silakan hubungi admin untuk menambah sesi.`,
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
        message: `Failed to start WhatsApp session: ${wahaError?.message || 'Unknown error'
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

          // Emit session update if status changed
          if (updated.status !== s.status) {
            emitSessionUpdate({
              sessionId: updated.sessionId,
              status: updated.status,
              phoneNumber: updated.phoneNumber,
            });
          }

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

// Start (or restart) an existing session
router.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const wahaSession = await wahaService.startSession(session.sessionId);

    const updated = await prisma.session.update({
      where: { id },
      data: {
        status: 'starting',
        qrCode: null,
      },
    });

    // Emit session update event
    emitSessionUpdate({
      sessionId: updated.sessionId,
      status: updated.status,
      phoneNumber: updated.phoneNumber,
    });

    return res.json({ success: true, data: { session: updated, waha: wahaSession } });
  } catch (error: any) {
    console.error('[SESSION] Failed to start session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to start session',
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
        // WAHA base64 format (docs): { mimetype: 'image/png', data: 'base64...' }
        const mime = qrResp.data?.mimetype;
        const data = qrResp.data?.data;
        if (mime && data) {
          dataUrl = `data:${mime};base64,${data}`;
        } else {
          // Legacy/variant keys
          const base64 =
            qrResp.data?.base64 || qrResp.data?.qr || qrResp.data?.image;
          if (base64) {
            dataUrl = base64.startsWith('data:')
              ? base64
              : `data:image/png;base64,${base64}`;
          }
        }
      } else if (qrResp.format === 'png') {
        dataUrl = qrResp.data;
      } else if (qrResp.format === 'raw') {
        // WAHA raw format (docs): { value: '...' }
        const rawValue =
          typeof qrResp.data === 'string'
            ? qrResp.data
            : (qrResp.data?.value as string | undefined);
        if (rawValue) dataUrl = rawValue;
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
      // WAHA base64 screenshot format (docs): { mimetype: 'image/png', data: 'base64...' }
      const mime = shot.data?.mimetype;
      const data = shot.data?.data;
      if (mime && data) {
        dataUrl = `data:${mime};base64,${data}`;
      } else {
        const base64 = shot.data?.base64 || shot.data?.file?.base64 || null;
        if (base64) {
          dataUrl = base64.startsWith('data:')
            ? base64
            : `data:image/jpeg;base64,${base64}`;
        }
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

    const updated = await prisma.session.update({
      where: { id },
      data: {
        status: 'stopped',
      },
    });

    // Emit session update event
    emitSessionUpdate({
      sessionId: updated.sessionId,
      status: updated.status,
      phoneNumber: updated.phoneNumber,
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

    // Emit session update event for deletion
    emitSessionUpdate({
      sessionId: session.sessionId,
      status: 'deleted',
      phoneNumber: session.phoneNumber,
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

// Reset job count untuk session (manual override)
router.post('/:id/reset-jobs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Reset job count dan status resting
    await prisma.session.update({
      where: { id },
      data: {
        jobCount: 0,
        jobLimitReached: false,
        restingUntil: null
      } as any // Type assertion karena fields baru belum di-generate
    });

    console.log(`[SESSION][RESET-JOBS] Reset job count for session ${session.name}`);

    return res.json({
      success: true,
      message: `Job count reset untuk session ${session.name}`,
    });
  } catch (error: any) {
    console.error('[SESSION][RESET-JOBS] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to reset job count',
    });
  }
});

// Retry waiting messages (kirim ulang pesan yang menunggu)
router.post('/retry-waiting', async (_req: Request, res: Response) => {
  try {
    // Cari session yang available
    const availableSessions = await prisma.session.findMany({
      where: {
        status: { in: ['working', 'ready', 'authenticated'] },
      }
    });

    // Filter yang tidak sedang resting
    const readySessions = availableSessions.filter((s: any) =>
      !s.jobLimitReached && (!s.restingUntil || new Date(s.restingUntil) < new Date())
    );

    if (readySessions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada session yang tersedia untuk retry',
      });
    }

    // Cari pesan dengan status 'waiting'
    const waitingMessages = await prisma.message.findMany({
      where: { status: 'waiting' },
      include: { contact: true, campaign: true }
    });

    if (waitingMessages.length === 0) {
      return res.json({
        success: true,
        message: 'Tidak ada pesan yang menunggu untuk dikirim ulang',
        data: { count: 0 }
      });
    }

    // Update status menjadi pending untuk di-queue ulang
    await prisma.message.updateMany({
      where: { status: 'waiting' },
      data: { status: 'pending', errorMsg: null }
    });

    console.log(`[SESSION][RETRY-WAITING] Marked ${waitingMessages.length} messages as pending for retry`);

    return res.json({
      success: true,
      message: `${waitingMessages.length} pesan akan dikirim ulang`,
      data: {
        count: waitingMessages.length,
        availableSessions: readySessions.length
      }
    });
  } catch (error: any) {
    console.error('[SESSION][RETRY-WAITING] Error:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to retry waiting messages',
    });
  }
});

export default router;

