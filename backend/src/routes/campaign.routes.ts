import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import campaignQueue from '../services/queue.service';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Protect all campaign routes
router.use(authMiddleware);

// Create campaign
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, message, imageUrl, sessionId, buttons } = req.body;

    if (!name || !message || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Name, message, and sessionId are required',
      });
    }

    // Validate session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        name,
        message,
        imageUrl: imageUrl || null,
        sessionId,
      },
    });

    // Create buttons (max 2)
    if (buttons && Array.isArray(buttons) && buttons.length > 0) {
      const buttonData = buttons.slice(0, 2).map((btn: any, index: number) => ({
        campaignId: campaign.id,
        label: btn.label,
        url: btn.url,
        order: index + 1,
      }));

      await prisma.button.createMany({
        data: buttonData,
      });
    }

    // Fetch campaign with buttons
    const campaignWithButtons = await prisma.campaign.findUnique({
      where: { id: campaign.id },
      include: { buttons: true },
    });

    res.json({
      success: true,
      data: campaignWithButtons,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get all campaigns
router.get('/', async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: {
        buttons: true,
        session: true,
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: campaigns,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get campaign by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        buttons: true,
        session: true,
        messages: {
          include: {
            contact: true,
          },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    res.json({
      success: true,
      data: campaign,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Send campaign
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { contactIds } = req.body; // Array of contact IDs or null for all

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        buttons: true,
        session: true,
      },
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found',
      });
    }

    // Check session status
    if (campaign.session.status !== 'working') {
      return res.status(400).json({
        success: false,
        message: 'Session is not active. Please scan QR code first.',
      });
    }

    // Get contacts
    const where = contactIds && contactIds.length > 0 ? { id: { in: contactIds } } : {};
    const contacts = await prisma.contact.findMany({ where });

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No contacts found',
      });
    }

    // Create message records
    const messageData = contacts.map((contact: any) => ({
      campaignId: campaign.id,
      contactId: contact.id,
      status: 'pending',
    }));

    await prisma.message.createMany({
      data: messageData,
    });

    // Update campaign
    await prisma.campaign.update({
      where: { id },
      data: {
        status: 'sending',
        totalContacts: contacts.length,
      },
    });

    // Add jobs to queue with message index for delay calculation
    const buttons = campaign.buttons.map((btn: any) => ({
      label: btn.label,
      url: btn.url,
    }));

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      await campaignQueue.add({
        campaignId: campaign.id,
        contactId: contact.id,
        phoneNumber: contact.phoneNumber,
        message: campaign.message,
        imageUrl: campaign.imageUrl,
        buttons,
        sessionName: campaign.session.sessionId,
        messageIndex: i, // Pass index for delay calculation
      });
    }

    res.json({
      success: true,
      message: `Campaign queued for ${contacts.length} contacts`,
      data: {
        campaignId: campaign.id,
        totalContacts: contacts.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update campaign
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, message, imageUrl, buttons } = req.body;

    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        name,
        message,
        imageUrl,
      },
    });

    // Update buttons
    if (buttons) {
      // Delete existing buttons
      await prisma.button.deleteMany({
        where: { campaignId: id },
      });

      // Create new buttons
      const buttonData = buttons.slice(0, 2).map((btn: any, index: number) => ({
        campaignId: id,
        label: btn.label,
        url: btn.url,
        order: index + 1,
      }));

      await prisma.button.createMany({
        data: buttonData,
      });
    }

    const updatedCampaign = await prisma.campaign.findUnique({
      where: { id },
      include: { buttons: true },
    });

    res.json({
      success: true,
      data: updatedCampaign,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Delete campaign
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.campaign.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'Campaign deleted successfully',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
