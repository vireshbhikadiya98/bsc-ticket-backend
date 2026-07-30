const express = require('express');
const prisma = require('./db');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();

// GET COMPANY DEPOSIT ADDRESS & USER DEPOSITS
router.get('/', authenticateToken, async (req, res) => {
  try {
    let settings = await prisma.systemSetting.findFirst();
    if (!settings) {
      settings = await prisma.systemSetting.create({
        data: { companyUsdtAddress: '0x0000000000000000000000000000000000000000' }
      });
    }

    const userDeposits = await prisma.deposit.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      companyUsdtAddress: settings.companyUsdtAddress,
      deposits: userDeposits
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SUBMIT TRANSACTION HASH FOR DEPOSIT
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { txHash, amount } = req.body;

    if (!txHash || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Valid transaction hash and positive amount are required.' });
    }

    const cleanHash = txHash.trim();

    const existingHash = await prisma.deposit.findUnique({ where: { txHash: cleanHash } });
    if (existingHash) {
      return res.status(400).json({ error: 'This transaction hash has already been submitted.' });
    }

    const deposit = await prisma.deposit.create({
      data: {
        userId: req.user.userId,
        txHash: cleanHash,
        amount: parseFloat(amount),
        status: 'PENDING'
      }
    });

    res.status(201).json({ message: 'Deposit request submitted successfully for approval.', deposit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN: APPROVE / REJECT DEPOSIT
router.post('/admin/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { depositId, status, adminNote } = req.body; // status: APPROVED or REJECTED

    const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
    if (!deposit || deposit.status !== 'PENDING') {
      return res.status(400).json({ error: 'Deposit request not found or already processed.' });
    }

    if (status === 'APPROVED') {
      // Credit Funding Wallet and update deposit status
      await prisma.$transaction([
        prisma.deposit.update({
          where: { id: depositId },
          data: { status: 'APPROVED', adminNote }
        }),
        prisma.user.update({
          where: { id: deposit.userId },
          data: { fundingWallet: { increment: deposit.amount } }
        })
      ]);
      return res.json({ message: 'Deposit approved and funding wallet credited successfully.' });
    } else {
      await prisma.deposit.update({
        where: { id: depositId },
        data: { status: 'REJECTED', adminNote }
      });
      return res.json({ message: 'Deposit request rejected.' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
