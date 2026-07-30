const express = require('express');
const prisma = require('./db');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();

// UPDATE SYSTEM SETTINGS (USDT Address & Daily Reward Distribution Time)
router.post('/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { companyUsdtAddress, rewardEpochTime } = req.body;

    const settings = await prisma.systemSetting.upsert({
      where: { id: 1 },
      update: { companyUsdtAddress, rewardEpochTime },
      create: { companyUsdtAddress, rewardEpochTime }
    });

    res.json({ message: 'System settings updated successfully', settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
