const express = require('express');
const prisma = require('./db');
const { authenticateToken } = require('./auth');

const router = express.Router();

// Helper: Get Today's Epoch Date String (YYYY-MM-DD)
function getTodayCycleDate() {
  return new Date().toISOString().split('T')[0];
}

// 1. GET ALL LEVELS & USER PROGRESS
router.get('/levels', authenticateToken, async (req, res) => {
  try {
    const levels = await prisma.ticketLevel.findMany({
      where: { isActive: true },
      orderBy: { levelNumber: 'asc' }
    });

    const progress = await prisma.userLevelProgress.findMany({
      where: { userId: req.user.userId }
    });

    res.json({ levels, progress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. PURCHASE TICKET (Per Level)
router.post('/purchase', authenticateToken, async (req, res) => {
  try {
    const { levelNumber } = req.body;
    const userId = req.user.userId;
    const today = getTodayCycleDate();

    const level = await prisma.ticketLevel.findUnique({ where: { levelNumber: parseInt(levelNumber, 10) } });
    if (!level) return res.status(400).json({ error: 'Invalid ticket level.' });

    // Check user unlock status
    let userProgress = await prisma.userLevelProgress.findUnique({
      where: { userId_levelId: { userId, levelId: level.id } }
    });

    if (!userProgress || !userProgress.isUnlocked) {
      return res.status(403).json({ error: `Level ${level.levelNumber} is locked. Complete previous level streak first.` });
    }

    // Check if ticket already purchased today
    if (userProgress.lastPurchaseDate === today) {
      return res.status(400).json({ error: 'You have already purchased today’s ticket for this level.' });
    }

    // Check funding wallet balance
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user.fundingWallet < level.price) {
      return res.status(400).json({ error: `Insufficient funding wallet balance. Required: $${level.price}` });
    }

    const currentStreak = userProgress.consecutiveDays + 1;
    let principalReturnAmount = 0.0;
    let yieldRewardAmount = 0.0;

    // Day 4 onwards logic: Principal ($25) returns to funding wallet + 1% yield to earning wallet
    if (currentStreak >= 4) {
      principalReturnAmount = level.price;
      yieldRewardAmount = (level.price * level.dailyRewardPercent) / 100;
    }

    // Execute Database Operations inside Transaction
    await prisma.$transaction(async (tx) => {
      // Deduct ticket price from funding wallet
      let netFundingChange = -level.price + principalReturnAmount;
      await tx.user.update({
        where: { id: userId },
        data: {
          fundingWallet: { increment: netFundingChange },
          earningWallet: { increment: yieldRewardAmount }
        }
      });

      // Record Ticket Purchase
      await tx.ticketPurchase.create({
        data: {
          userId,
          levelId: level.id,
          amount: level.price,
          cycleDate: today,
          principalReturned: principalReturnAmount,
          rewardGranted: yieldRewardAmount
        }
      });

      // Update User Progress Streak
      await tx.userLevelProgress.update({
        where: { id: userProgress.id },
        data: {
          consecutiveDays: currentStreak,
          lastPurchaseDate: today
        }
      });

      // Unlock Next Level if 3 consecutive days completed
      if (currentStreak >= level.requiredDaysToUnlock) {
        const nextLevel = await tx.ticketLevel.findUnique({
          where: { levelNumber: level.levelNumber + 1 }
        });

        if (nextLevel) {
          await tx.userLevelProgress.upsert({
            where: { userId_levelId: { userId, levelId: nextLevel.id } },
            update: { isUnlocked: true },
            create: {
              userId,
              levelId: nextLevel.id,
              consecutiveDays: 0,
              isUnlocked: true
            }
          });
        }
      }

      // -----------------------------------------------------------------------
      // 5-LEVEL REFERRAL REWARD LOGIC
      // -----------------------------------------------------------------------
      
      // Check for $1 First-Time Purchase Bonus
      const totalUserPurchases = await tx.ticketPurchase.count({ where: { userId } });
      if (totalUserPurchases === 1 && user.sponsorId) {
        await tx.user.update({
          where: { id: user.sponsorId },
          data: { earningWallet: { increment: 1.0 } }
        });
        await tx.referralReward.create({
          data: {
            userId: user.sponsorId,
            fromUserId: userId,
            levelDepth: 1,
            amount: 1.0,
            rewardType: 'FIRST_PURCHASE_BONUS'
          }
        });
      }

      // 1% Referral Yield Match Up To 5 Levels Downside
      let currentSponsorId = user.sponsorId;
      for (let depth = 1; depth <= 5; depth++) {
        if (!currentSponsorId) break;

        const sponsor = await tx.user.findUnique({ where: { id: currentSponsorId } });
        if (!sponsor) break;

        // Verify sponsor has unlocked/cleared THIS specific level
        const sponsorProgress = await tx.userLevelProgress.findUnique({
          where: { userId_levelId: { userId: sponsor.id, levelId: level.id } }
        });

        if (sponsorProgress && sponsorProgress.isUnlocked) {
          const commissionAmount = (level.price * 0.01); // 1%
          await tx.user.update({
            where: { id: sponsor.id },
            data: { earningWallet: { increment: commissionAmount } }
          });

          await tx.referralReward.create({
            data: {
              userId: sponsor.id,
              fromUserId: userId,
              levelDepth: depth,
              amount: commissionAmount,
              rewardType: 'DAILY_YIELD_MATCH'
            }
          });
        }

        currentSponsorId = sponsor.sponsorId; // Move up to next ancestor level
      }
    });

    res.json({ message: 'Ticket purchased successfully!', streak: currentStreak });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. DEDICATED LEVEL HISTORY & ACTIVITY PAGE
router.get('/level-history/:levelNumber', authenticateToken, async (req, res) => {
  try {
    const { levelNumber } = req.params;
    const userId = req.user.userId;

    const level = await prisma.ticketLevel.findUnique({ where: { levelNumber: parseInt(levelNumber, 10) } });
    if (!level) return res.status(404).json({ error: 'Level not found' });

    const purchases = await prisma.ticketPurchase.findMany({
      where: { userId, levelId: level.id },
      orderBy: { createdAt: 'desc' }
    });

    const progress = await prisma.userLevelProgress.findUnique({
      where: { userId_levelId: { userId, levelId: level.id } }
    });

    res.json({ level, progress, purchases });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
