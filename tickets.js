const express = require('express');
const prisma = require('./db');
const { authenticateToken } = require('./auth');

const router = express.Router();

// Level prices in USDT/Tokens
const LEVEL_PRICES = {
  1: 25,
  2: 50,
  3: 75,
  4: 100
};

// -----------------------------------------------------------------------------
// BUY TICKET ENDPOINT (JWT Protected)
// -----------------------------------------------------------------------------
router.post('/buy-ticket', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { level } = req.body;

    const numLevel = Number(level);
    const ticketPrice = LEVEL_PRICES[numLevel];

    if (!numLevel || !ticketPrice) {
      return res.status(400).json({ error: 'Invalid level selected.' });
    }

    // 1. Check prerequisite completion (Level N requires Level N-1 COMPLETED)
    if (numLevel > 1) {
      const prevLevelCycle = await prisma.ticketCycle.findFirst({
        where: {
          userId,
          level: numLevel - 1,
          status: 'COMPLETED'
        }
      });

      if (!prevLevelCycle) {
        return res.status(400).json({
          error: `Level ${numLevel} is locked. Complete Level ${numLevel - 1} first!`
        });
      }
    }

    // 2. Process ticket purchase atomically
    const result = await prisma.$transaction(async (tx) => {
      // Check user funding wallet balance inside transaction
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || Number(user.fundingWallet) < ticketPrice) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // Fetch existing in-progress cycle or create new one
      let activeCycle = await tx.ticketCycle.findFirst({
        where: {
          userId,
          level: numLevel,
          status: 'IN_PROGRESS'
        }
      });

      if (!activeCycle) {
        activeCycle = await tx.ticketCycle.create({
          data: {
            userId,
            level: numLevel,
            daysCompleted: 0,
            status: 'IN_PROGRESS'
          }
        });
      }

      // Check 24-hour purchase cooldown if not the first ticket in cycle
      if (activeCycle.lastPurchasedAt) {
        const hoursPassed = (new Date() - new Date(activeCycle.lastPurchasedAt)) / (1000 * 60 * 60);
        if (hoursPassed < 24) {
          throw new Error('COOLDOWN_ACTIVE');
        }
      }

      // Deduct ticket price from Funding Wallet
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          fundingWallet: { decrement: ticketPrice }
        }
      });

      const nextDay = activeCycle.daysCompleted + 1;
      const isCycleFinished = nextDay === 3;

      // Update cycle progress
      const updatedCycle = await tx.ticketCycle.update({
        where: { id: activeCycle.id },
        data: {
          daysCompleted: nextDay,
          status: isCycleFinished ? 'COMPLETED' : 'IN_PROGRESS',
          lastPurchasedAt: new Date()
        }
      });

      // --- IF CYCLE IS COMPLETED (3 DAYS PURCHASED) ---
      if (isCycleFinished) {
        const totalPrincipal = ticketPrice * 3;
        const rewardAmount = totalPrincipal * 0.01; // 1% return on total volume

        // Refund 100% principal back to Funding Wallet + 1% reward to Earning Wallet
        await tx.user.update({
          where: { id: userId },
          data: {
            fundingWallet: { increment: totalPrincipal },
            earningWallet: { increment: rewardAmount }
          }
        });

        // Distribute 5-Tier Referral Rewards (1% of total cycle volume)
        await distributeReferralRewards(tx, userId, totalPrincipal);
      }

      return { updatedUser, updatedCycle, isCycleFinished };
    });

    res.json({
      message: result.isCycleFinished
        ? `Level ${numLevel} Cycle Completed! Principal returned to Funding Wallet and reward credited to Earning Wallet.`
        : `Ticket for Day ${result.updatedCycle.daysCompleted} purchased successfully!`,
      fundingWallet: result.updatedUser.fundingWallet,
      earningWallet: result.updatedUser.earningWallet,
      cycle: result.updatedCycle
    });

  } catch (error) {
    if (error.message === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({ error: 'Insufficient funds in Funding Wallet.' });
    }
    if (error.message === 'COOLDOWN_ACTIVE') {
      return res.status(400).json({ error: 'You must wait 24 hours between ticket purchases.' });
    }
    console.error('Ticket Purchase Error:', error);
    res.status(500).json({ error: error.message || 'Server error processing ticket purchase.' });
  }
});

// Helper: Distribute 1% referral reward up to 5 sponsor tiers
async function distributeReferralRewards(tx, purchaserId, totalLevelVolume) {
  let currentUserId = purchaserId;

  for (let depth = 1; depth <= 5; depth++) {
    const user = await tx.user.findUnique({
      where: { id: currentUserId },
      select: { sponsorId: true }
    });

    if (!user || !user.sponsorId) break;

    const commissionAmount = totalLevelVolume * 0.01;

    // Credit sponsor's Earning Wallet
    await tx.user.update({
      where: { id: user.sponsorId },
      data: { earningWallet: { increment: commissionAmount } }
    });

    // Record Referral Audit Log
    await tx.referralReward.create({
      data: {
        beneficiaryId: user.sponsorId,
        fromUserId: purchaserId,
        depthLevel: depth,
        amount: commissionAmount
      }
    });

    currentUserId = user.sponsorId;
  }
}

module.exports = router;