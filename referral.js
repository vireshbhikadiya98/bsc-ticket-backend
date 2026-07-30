const express = require('express');
const prisma = require('./db');
const { authenticateToken } = require('./auth');

const router = express.Router();

// GET 5-LEVEL REFERRAL TREE & REWARD HISTORY
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Helper: Recursively fetch downlines up to 5 levels
    async function getDownlineTree(parentId, depth = 1) {
      if (depth > 5) return [];

      const directReferrals = await prisma.user.findMany({
        where: { sponsorId: parentId },
        select: {
          id: true,
          walletAddress: true,
          username: true,
          referralCode: true,
          createdAt: true
        }
      });

      const tree = [];
      for (const ref of directReferrals) {
        const subDownline = await getDownlineTree(ref.id, depth + 1);
        tree.push({
          ...ref,
          levelDepth: depth,
          subDownlineCount: subDownline.length,
          downline: subDownline
        });
      }
      return tree;
    }

    const downlineTree = await getDownlineTree(userId);

    // Fetch Reward Logs
    const rewards = await prisma.referralReward.findMany({
      where: { userId },
      include: {
        user: { select: { walletAddress: true, username: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      downlineTree,
      rewards
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
