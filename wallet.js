const express = require('express');
const prisma = require('./db');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();

// -----------------------------------------------------------------------------
// 1. SUBMIT WITHDRAWAL REQUEST (Only from Earning Wallet)
// -----------------------------------------------------------------------------
router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId; // Securely retrieved from JWT token
    const { amount, destAddress } = req.body;

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || !destAddress) {
      return res.status(400).json({ error: 'Invalid withdrawal details provided.' });
    }

    // Perform atomic transaction with check inside to prevent race condition
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || Number(user.earningWallet) < numAmount) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          earningWallet: { decrement: numAmount }
        }
      });

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amount: numAmount,
          destAddress,
          status: 'PENDING'
        }
      });

      return { updatedUser, withdrawal };
    });

    res.json({
      message: 'Withdrawal request submitted successfully! Pending admin approval.',
      newEarningBalance: result.updatedUser.earningWallet,
      withdrawal: result.withdrawal
    });

  } catch (error) {
    if (error.message === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ error: 'Insufficient funds in Earning Wallet.' });
    }
    console.error('Withdrawal Request Error:', error);
    res.status(500).json({ error: error.message || 'Server error processing withdrawal.' });
  }
});

// -----------------------------------------------------------------------------
// 2. GET USER DASHBOARD DATA & HISTORY
// -----------------------------------------------------------------------------
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        referralCode: true,
        fundingWallet: true,
        earningWallet: true,
        role: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const cycles = await prisma.ticketCycle.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    const deposits = await prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const withdrawals = await prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const referralRewards = await prisma.referralReward.findMany({
      where: { beneficiaryId: userId },
      include: { fromUser: { select: { email: true } } },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      user,
      cycles,
      history: {
        deposits,
        withdrawals,
        referralRewards
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// 3. ADMIN: OVERVIEW & APPROVE/REJECT WITHDRAWALS
// -----------------------------------------------------------------------------
router.get('/admin/overview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fundingWallet: true,
        earningWallet: true,
        referralCode: true,
        role: true,
        createdAt: true
      }
    });

    const pendingWithdrawals = await prisma.withdrawal.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ users, pendingWithdrawals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN: APPROVE WITHDRAWAL
router.post('/admin/withdrawal/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { withdrawalId } = req.body;

    const updated = await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'APPROVED' }
    });

    res.json({ message: 'Withdrawal approved successfully.', withdrawal: updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN: REJECT WITHDRAWAL (REFUNDS EARNING WALLET)
router.post('/admin/withdrawal/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { withdrawalId } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });

      if (!withdrawal || withdrawal.status !== 'PENDING') {
        throw new Error('INVALID_WITHDRAWAL');
      }

      // Refund the funds to user's earning wallet
      await tx.user.update({
        where: { id: withdrawal.userId },
        data: { earningWallet: { increment: withdrawal.amount } }
      });

      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED' }
      });

      return updatedWithdrawal;
    });

    res.json({ message: 'Withdrawal rejected and funds refunded to user.', withdrawal: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;