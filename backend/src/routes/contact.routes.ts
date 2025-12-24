import { Router, Request, Response } from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import prisma from '../lib/prisma';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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

    const stream = Readable.from(text);
    stream
      .pipe(
        csv({
          separator,
          mapHeaders: ({ header }) => normalizeHeader(header),
        })
      )
      .on('data', (row: any) => {
        const name = row?.name || row?.nama || row?.fullname || row?.fullname || row?.contactname;
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

        if (name && phoneRaw) {
          const phoneNumber = String(phoneRaw).replace(/\D/g, '');
          if (!phoneNumber) return;
          contacts.push({
            name: String(name).trim(),
            phoneNumber,
            email: emailRaw ? String(emailRaw).trim() : null,
          });
        }
      })
      .on('end', () => resolve(contacts))
      .on('error', (err: any) => reject(err));
  });
}

// Upload CSV contacts (supports single or multiple files)
router.post('/upload', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 20 }]), async (req: Request, res: Response) => {
  try {
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

    const perFile: Array<{ filename: string; imported: number }> = [];
    let totalImported = 0;

    for (const f of files) {
      const parsed = await parseCsvBuffer(f.buffer);

      if (parsed.length === 0) {
        perFile.push({ filename: f.originalname, imported: 0 });
        continue;
      }

      const result = await Promise.all(
        parsed.map((contact) =>
          prisma.contact.upsert({
            where: { phoneNumber: contact.phoneNumber },
            update: contact,
            create: contact,
          })
        )
      );

      perFile.push({ filename: f.originalname, imported: result.length });
      totalImported += result.length;
    }

    return res.json({
      success: true,
      message: `${totalImported} contacts imported successfully from ${files.length} file(s)`,
      data: {
        imported: totalImported,
        files: perFile,
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
    const { page = 1, limit = 50, search = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = search
      ? {
          OR: [
            { name: { contains: String(search), mode: 'insensitive' as const } },
            { phoneNumber: { contains: String(search) } },
          ],
        }
      : {};

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

    if (!name || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Name and phone number are required',
      });
    }

    const contact = await prisma.contact.create({
      data: {
        name,
        phoneNumber: phoneNumber.replace(/\D/g, ''),
        email,
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
