const express = require('express');
const prisma = require('./db');
const { authenticateToken } = require('./auth');

const router = express.Router();

// -----------------------------------------------------------------------------
// 1. UPDATE USERNAME (JWT Protected)
// -----------------------------------------------------------------------------
router.post('/profile/update-username', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username } = req.body;

    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    const cleanUsername = username.trim();

    // Check if username is already taken
    const existingUser = await prisma.user.findFirst({
      where: {
        username: { equals: cleanUsername, mode: 'insensitive' },
        NOT: { id: userId }
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken. Please choose another.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { username: cleanUsername }
    });

    res.json({ message: 'Username updated successfully!', username: updatedUser.username });
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// -----------------------------------------------------------------------------
// 2. ADD MISSED REFERRAL / SPONSOR CODE (JWT Protected)
// -----------------------------------------------------------------------------
router.post('/profile/add-sponsor', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sponsorCode } = req.body;

    if (!sponsorCode || !sponsorCode.trim()) {
      return res.status(400).json({ error: 'Sponsor code is required.' });
    }

    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) return res.status(404).json({ error: 'User not found.' });

    if (currentUser.sponsorId || currentUser.referredBy) {
      return res.status(400).json({ error: 'You already have a sponsor linked to your account.' });
    }

    const cleanCode = sponsorCode.trim();

    if (cleanCode.toUpperCase() === currentUser.referralCode?.toUpperCase()) {
      return res.status(400).json({ error: 'You cannot use your own referral code as a sponsor.' });
    }

    // Find sponsor by referral code
    const sponsor = await prisma.user.findFirst({
      where: {
        referralCode: {
          equals: cleanCode,
          mode: 'insensitive'
        }
      }
    });

    if (!sponsor) {
      return res.status(400).json({ error: 'Invalid sponsor code. User does not exist.' });
    }

    // Link sponsor relation and referral code string
    await prisma.user.update({
      where: { id: userId },
      data: {
        sponsorId: sponsor.id,
        referredBy: sponsor.referralCode
      }
    });

    res.json({ message: 'Sponsor linked successfully!', sponsorCode: sponsor.referralCode });
  } catch (error) {
    console.error('Add sponsor error:', error);
    res.status(500).json({ error: 'Failed to link sponsor.' });
  }
});

module.exports = router;