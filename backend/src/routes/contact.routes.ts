
import { Parser as CsvParser } from 'json2csv';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';
import { SESSION_CONTACT_LIMIT } from '../services/session-rotation.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// INTERNAL: Export and delete contacts (CSV, only via terminal/curl, not for frontend UI)
router.post('/export-and-delete', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    let where: any = {};
    if (sessionId) where.sessionId = String(sessionId);

    const contacts = await prisma.contact.findMany({ where });
    if (!contacts.length) {
      return res.status(404).json({ success: false, message: 'No contacts found to export.' });
    }

    // Prepare CSV
    const fields = ['id', 'name', 'phoneNumber', 'email', 'createdAt', 'sessionId'];
    const parser = new CsvParser({ fields });
    const csv = parser.parse(contacts);

    // Hapus kontak yang diekspor
    await prisma.contact.deleteMany({ where });

    // Kirim file CSV
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts_export.csv"');
    res.status(200).send(csv);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// Protect all contact routes
router.use(authMiddleware);

function normalizeHeader(header: any): string {
  const raw = String(header ?? '')
    .replace(/^\uFEFF/, '') // strip BOM
    .trim()
    .toLowerCase();
  // remove common separators/spaces: phone_number, phone-number, "phone number" -> phonenumber
  return raw.replace(/[^a-z0-9]/g, '');
}

function detectSeparator(text: string): string {
  const firstNonEmptyLine =
    text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const commaCount = (firstNonEmptyLine.match(/,/g) || []).length;
  const semiCount = (firstNonEmptyLine.match(/;/g) || []).length;
  return semiCount > commaCount ? ';' : ',';
}

function parseCsvBuffer(buffer: Buffer): Promise<Array<{ name: string; phoneNumber: string; email: string | null }>> {
  return new Promise((resolve, reject) => {
    const contacts: Array<{ name: string; phoneNumber: string; email: string | null }> = [];

    const text = buffer.toString('utf8');
    const separator = detectSeparator(text);

    // Debug: log first line to see headers
    const firstLine = text.split(/\r?\n/)[0];
    console.log(`[CSV-IMPORT] First line (headers): "${firstLine}"`);
    console.log(`[CSV-IMPORT] Detected separator: "${separator}"`);

    const stream = Readable.from(text);
    stream
      .pipe(
        csv({
          separator,
          mapHeaders: ({ header }) => {
            const normalized = normalizeHeader(header);
            console.log(`[CSV-IMPORT] Header mapping: "${header}" → "${normalized}"`);
            return normalized;
          },
        })
      )
      .on('data', (row: any) => {
        // Debug: log raw row
        console.log(`[CSV-IMPORT] Raw row:`, JSON.stringify(row));

        const nameRaw = row?.name || row?.nama || row?.fullname || row?.contactname || '';
        const phoneRaw =
          row?.phonenumber ||
          row?.phone ||
          row?.whatsapp ||
          row?.wa ||
          row?.nohp ||
          row?.nomor ||
          row?.nomortelepon ||
          row?.number ||
          row?.msisdn;
        const emailRaw = row?.email || row?.mail;

        // Only require phone number - name can be empty (will use phone as fallback)
        if (phoneRaw) {
          const phoneNumber = String(phoneRaw).replace(/\D/g, '');
          if (!phoneNumber) return;

          // Use phone number as name fallback if name is empty
          const name = String(nameRaw || phoneNumber).trim();

          console.log(`[CSV-IMPORT] Parsed contact: name="${name}", phone="${phoneNumber}"`);

          contacts.push({
            name,
            phoneNumber,
            email: emailRaw ? String(emailRaw).trim() : null,
          });
        }
      })
      .on('end', () => {
        console.log(`[CSV-IMPORT] Total contacts parsed: ${contacts.length}`);
        resolve(contacts);
      })
      .on('error', (err: any) => reject(err));
  });
}

const GLOBAL_CONTACT_LIMIT = 500;

// Upload CSV contacts (supports single or multiple files)
router.post('/upload', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 20 }]), async (req: Request, res: Response) => {
  try {
    // SessionID is no longer required for global contacts
    const uploaded = (req as any).files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const combined: Express.Multer.File[] = [
      ...(uploaded?.files || []),
      ...(uploaded?.file || []),
    ];

    // Deduplicate in case client sends both `files` and legacy `file`
    const files = combined.filter((f, idx) => {
      const firstIdx = combined.findIndex(
        (x) => x.originalname === f.originalname && x.size === f.size
      );
      return firstIdx === idx;
    });

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const perFile: Array<{ filename: string; imported: number; discarded: number }> = [];
    let totalImported = 0;
    let totalDiscarded = 0;

    // Get current contact count (GLOBAL)
    const currentCount = await prisma.contact.count();
    let remainingQuota = GLOBAL_CONTACT_LIMIT - currentCount;

    if (remainingQuota <= 0) {
      return res.status(400).json({
        success: false,
        message: `Global limit reached (${GLOBAL_CONTACT_LIMIT} contacts). Please delete some contacts first.`,
      });
    }

    for (const f of files) {
      // Parse ALL contacts from file first
      const parsed = await parseCsvBuffer(f.buffer);

      if (parsed.length === 0) {
        perFile.push({ filename: f.originalname, imported: 0, discarded: 0 });
        continue;
      }

      // Calculate how many we can import from this file
      const canImport = Math.min(parsed.length, remainingQuota);
      const toImport = parsed.slice(0, canImport);
      const discardedCount = parsed.length - canImport;

      // Import the allowed batch
      const result = await Promise.all(
        toImport.map((contact) =>
          prisma.contact.upsert({
            where: { phoneNumber: contact.phoneNumber }, // Global unique check
            update: { ...contact, sessionId: null }, // Ensure sessionId is null for global
            create: { ...contact, sessionId: null },
          })
        )
      );

      // Verify how many were actually created/updated (upsert returns record)
      const importedCount = result.length;

      perFile.push({
        filename: f.originalname,
        imported: importedCount,
        discarded: discardedCount
      });

      totalImported += importedCount;
      totalDiscarded += discardedCount;
      remainingQuota -= importedCount;

      // If we've hit the limit, stop processing further files
      if (remainingQuota <= 0) break;
    }

    let message = `${totalImported} contacts imported successfully.`;
    if (totalDiscarded > 0) {
      message += ` ${totalDiscarded} contacts were discarded because the global limit of ${GLOBAL_CONTACT_LIMIT} was reached.`;
    }

    return res.json({
      success: true,
      message,
      data: {
        imported: totalImported,
        discarded: totalDiscarded,
        files: perFile,
        globalCount: currentCount + totalImported,
        limit: GLOBAL_CONTACT_LIMIT
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get all contacts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 50, search = '', sessionId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let where: any = {};
    // BYPASS: Ignore sessionId filter to return global contacts even if requested by legacy frontend
    // if (sessionId && sessionId !== 'undefined' && sessionId !== 'null') {
    //   where.sessionId = String(sessionId);
    // }
    if (search) {
      where = {
        ...where,
        OR: [
          { name: { contains: String(search), mode: 'insensitive' as const } },
          { phoneNumber: { contains: String(search) } },
        ],
      };
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.contact.count({ where }),
    ]);

    res.json({
      success: true,
      data: contacts,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Bulk delete contacts (selected or all)
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids, all } = req.body as { ids?: string[]; all?: boolean };

    if (all === true) {
      const result = await prisma.contact.deleteMany({});
      return res.json({
        success: true,
        message: `${result.count} contacts deleted successfully`,
        data: { deleted: result.count },
      });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide contact ids to delete',
      });
    }

    const result = await prisma.contact.deleteMany({
      where: { id: { in: ids } },
    });

    return res.json({
      success: true,
      message: `${result.count} contacts deleted successfully`,
      data: { deleted: result.count },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create contact manually
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, phoneNumber, email } = req.body;
    // SessionID is no longer required/used

    if (!name || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Name and phone number are required',
      });
    }

    // Check GLOBAL contact limit
    const currentCount = await prisma.contact.count();
    if (currentCount >= GLOBAL_CONTACT_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `Global limit exceeded. Maksimal ${GLOBAL_CONTACT_LIMIT} kontak (Global).`,
      });
    }

    const contact = await prisma.contact.create({
      data: {
        name,
        phoneNumber: phoneNumber.replace(/\D/g, ''),
        email,
        sessionId: null, // Global contact
      },
    });

    res.json({
      success: true,
      data: contact,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Delete contact
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.contact.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Contact deleted successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
