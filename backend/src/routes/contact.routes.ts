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

// Upload CSV contacts
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const contacts: any[] = [];
    const stream = Readable.from(req.file.buffer.toString());

    stream
      .pipe(csv())
      .on('data', (row: any) => {
        // Expected CSV format: name, phoneNumber, email (optional)
        if (row.name && row.phoneNumber) {
          contacts.push({
            name: row.name,
            phoneNumber: row.phoneNumber.replace(/\D/g, ''), // Remove non-digits
            email: row.email || null,
          });
        }
      })
      .on('end', async () => {
        try {
          // Bulk insert contacts (upsert to avoid duplicates)
          const result = await Promise.all(
            contacts.map((contact) =>
              prisma.contact.upsert({
                where: { phoneNumber: contact.phoneNumber },
                update: contact,
                create: contact,
              })
            )
          );

          res.json({
            success: true,
            message: `${result.length} contacts imported successfully`,
            data: result,
          });
        } catch (error: any) {
          res.status(500).json({
            success: false,
            message: error.message,
          });
        }
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
