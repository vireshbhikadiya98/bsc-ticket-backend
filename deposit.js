const express = require('express');
const { ethers } = require('ethers');
const prisma = require('./db');
const { authenticateToken, requireAdmin } = require('./auth');

const router = express.Router();

// Binance Smart Chain Mainnet RPC URL & Official USDT Contract Address
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const USDT_CONTRACT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955'.toLowerCase();

// ERC-20 / BEP-20 Transfer Event Signature Hash: Transfer(address,address,uint256)
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// -----------------------------------------------------------------------------
// 1. GET PUBLIC DEPOSIT ADDRESS
// -----------------------------------------------------------------------------
router.get('/deposit-address', async (req, res) => {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'DEPOSIT_ADDRESS' }
    });

    res.json({ address: setting ? setting.value : '0x0000000000000000000000000000000000000000' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deposit address' });
  }
});

// -----------------------------------------------------------------------------
// 2. ADMIN: UPDATE SYSTEM DEPOSIT ADDRESS
// -----------------------------------------------------------------------------
router.post('/admin/deposit-address', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Valid BEP-20 address is required.' });
    }

    const setting = await prisma.systemSetting.upsert({
      where: { key: 'DEPOSIT_ADDRESS' },
      update: { value: address.trim().toLowerCase() },
      create: { key: 'DEPOSIT_ADDRESS', value: address.trim().toLowerCase() }
    });

    res.json({ message: 'Deposit address updated successfully', address: setting.value });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update deposit address: ' + error.message });
  }
});

// -----------------------------------------------------------------------------
// 3. VERIFY ON-CHAIN DEPOSIT (JWT Protected)
// -----------------------------------------------------------------------------
router.post('/verify-deposit', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId; // Securely retrieved from JWT payload
    const { txHash } = req.body;

    if (!txHash) {
      return res.status(400).json({ error: 'Transaction hash (txHash) is required.' });
    }

    const cleanTxHash = txHash.trim().toLowerCase();

    // 1. Check if TxHash has already been processed
    const existingDeposit = await prisma.deposit.findUnique({
      where: { txHash: cleanTxHash }
    });
    if (existingDeposit) {
      return res.status(400).json({ error: 'This transaction hash has already been claimed.' });
    }

    // 2. Fetch configured system deposit address
    const depositSetting = await prisma.systemSetting.findUnique({
      where: { key: 'DEPOSIT_ADDRESS' }
    });

    if (!depositSetting || !depositSetting.value) {
      return res.status(500).json({ error: 'System deposit address is not configured.' });
    }

    const targetMasterWallet = depositSetting.value.toLowerCase();

    // 3. Query BSC Blockchain
    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
    const receipt = await provider.getTransactionReceipt(cleanTxHash);

    if (!receipt || receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction not found or failed on BSC network.' });
    }

    // 4. Inspect receipt logs for valid USDT Transfer
    let creditedAmount = 0;
    let isValidTransfer = false;

    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() === USDT_CONTRACT_ADDRESS &&
        log.topics[0] === TRANSFER_EVENT_TOPIC &&
        log.topics.length >= 3
      ) {
        // Decode recipient address from topic 2
        const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();

        if (toAddress === targetMasterWallet) {
          // Decode USDT amount (USDT on BSC uses 18 decimals)
          const rawAmount = BigInt(log.data);
          creditedAmount = Number(ethers.formatUnits(rawAmount, 18));
          isValidTransfer = true;
          break;
        }
      }
    }

    if (!isValidTransfer || creditedAmount <= 0) {
      return res.status(400).json({
        error: 'No valid USDT transfer to the platform deposit address found in this transaction.'
      });
    }

    // 5. Atomic DB Transaction to store deposit log and credit Funding Wallet
    const result = await prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.create({
        data: {
          userId,
          txHash: cleanTxHash,
          amount: creditedAmount
        }
      });

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          fundingWallet: {
            increment: creditedAmount
          }
        }
      });

      return { deposit, newBalance: updatedUser.fundingWallet };
    });

    res.json({
      message: 'Deposit verified and credited successfully!',
      amountCredited: creditedAmount,
      newFundingBalance: result.newBalance
    });

  } catch (error) {
    console.error('Deposit verification error:', error);
    res.status(500).json({ error: 'Failed to verify transaction: ' + error.message });
  }
});

module.exports = router;