const express = require('express');
const prisma = require('./db');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();

// -----------------------------------------------------------------------------
// 1. GET ACTIVE BANNERS FOR DASHBOARD (Public)
// -----------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const banners = await prisma.banner.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    // Fallback default banners if database has none
    if (banners.length === 0) {
      return res.json([
        {
          id: 'default-1',
          title: 'Welcome to BSC Ticket Platform',
          imageUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?q=80&w=1000&auto=format&fit=crop',
          isActive: true
        },
        {
          id: 'default-2',
          title: 'Stake USDT & Earn Daily Rewards',
          imageUrl: 'https://images.unsplash.com/photo-1622979135225-d2ba269bc1bd?q=80&w=1000&auto=format&fit=crop',
          isActive: true
        }
      ]);
    }

    res.json(banners);
  } catch (error) {
    console.error('Error fetching banners:', error);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

// -----------------------------------------------------------------------------
// 2. ADMIN: ADD NEW BANNER (Protected)
// -----------------------------------------------------------------------------
router.post('/admin/add', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, imageUrl } = req.body;

    if (!imageUrl || !imageUrl.trim()) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    const banner = await prisma.banner.create({
      data: {
        title: title ? title.trim() : 'Announcement',
        imageUrl: imageUrl.trim(),
        isActive: true
      }
    });

    res.status(201).json({ message: 'Banner added successfully', banner });
  } catch (error) {
    console.error('Add banner error:', error);
    res.status(500).json({ error: 'Failed to add banner' });
  }
});

// -----------------------------------------------------------------------------
// 3. ADMIN: DEACTIVATE / DELETE BANNER (Protected)
// -----------------------------------------------------------------------------
router.delete('/admin/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.banner.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ message: 'Banner deactivated successfully.' });
  } catch (error) {
    console.error('Delete banner error:', error);
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

module.exports = router;