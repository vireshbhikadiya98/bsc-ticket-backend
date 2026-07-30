const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('./db');

const router = express.Router();

// Strict Password Validation: Min 6 chars, 1 Uppercase, 1 Lowercase, 1 Number, 1 Special Char
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;

// Helper: Generate Unique 8-Character Referral Code
async function generateUniqueReferralCode() {
  let code;
  let exists = true;
  while (exists) {
    code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const found = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!found) exists = false;
  }
  return code;
}

// =============================================================================
// MIDDLEWARES (EXPORTED FOR OTHER ROUTE FILES)
// =============================================================================

// 1. JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = decoded;
    next();
  });
};

// 2. Admin Authorization Middleware
const requireAdmin = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });

    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied: Admin privileges required.' });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization error: ' + error.message });
  }
};

// =============================================================================
// AUTH ROUTES
// =============================================================================

// SIGNUP (REGISTER WITH BSC WALLET ADDRESS)
router.post('/register', async (req, res) => {
  try {
    const { walletAddress, username, password, confirmPassword, referralCode } = req.body;

    if (!walletAddress || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Wallet address, password, and confirm password are required.' });
    }

    const cleanWallet = walletAddress.trim().toLowerCase();

    // 1. Validate BSC Wallet Address Format (0x + 40 hex characters)
    if (!/^0x[a-fA-F0-9]{40}$/.test(cleanWallet)) {
      return res.status(400).json({ error: 'Please enter a valid BSC Wallet Address (0x...).' });
    }

    // 2. Check Passwords Match
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match!' });
    }

    // 3. Enforce Password Policy
    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long and contain an uppercase letter, lowercase letter, number, and special character (@$!%*?&).'
      });
    }

    // 4. Check Existing User by Wallet Address
    const existingUser = await prisma.user.findUnique({ where: { walletAddress: cleanWallet } });
    if (existingUser) {
      return res.status(400).json({ error: 'This BSC Wallet Address is already registered. Please log in!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Handle Sponsor / Referral Link
    let sponsorId = null;
    if (referralCode && referralCode.trim() !== '') {
      const parentUser = await prisma.user.findUnique({
        where: { referralCode: referralCode.trim() }
      });
      if (parentUser) {
        sponsorId = parentUser.id;
      }
    }

    const userReferralCode = await generateUniqueReferralCode();

    // 6. Create User Record
    const user = await prisma.user.create({
      data: {
        walletAddress: cleanWallet,
        username: username ? username.trim() : null,
        password: hashedPassword,
        sponsorId,
        referralCode: userReferralCode,
        isVerified: true // Set to true directly (No OTP required)
      }
    });

    // 7. Auto-unlock Level 1 for the new user
    const level1 = await prisma.ticketLevel.findUnique({ where: { levelNumber: 1 } });
    if (level1) {
      await prisma.userLevelProgress.create({
        data: {
          userId: user.id,
          levelId: level1.id,
          consecutiveDays: 0,
          isUnlocked: true
        }
      });
    }

    // 8. Generate Auth Token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account registered successfully!',
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        referralCode: user.referralCode,
        fundingWallet: user.fundingWallet,
        earningWallet: user.earningWallet,
        role: user.role
      }
    });
  } catch (error) {
    console.error('SIGNUP ERROR LOG:', error);
    res.status(500).json({ error: error.message || 'Server error during signup' });
  }
});

// LOGIN (WITH BSC WALLET ADDRESS + PASSWORD)
router.post('/login', async (req, res) => {
  try {
    const { walletAddress, password } = req.body;

    if (!walletAddress || !password) {
      return res.status(400).json({ error: 'BSC Wallet address and password are required' });
    }

    const cleanWallet = walletAddress.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { walletAddress: cleanWallet } });

    if (!user) {
      return res.status(400).json({ error: 'Invalid wallet address or password' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid wallet address or password' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Logged in successfully!',
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        referralCode: user.referralCode,
        fundingWallet: user.fundingWallet,
        earningWallet: user.earningWallet,
        role: user.role
      }
    });
  } catch (error) {
    console.error('LOGIN ERROR LOG:', error);
    res.status(500).json({ error: error.message || 'Server error during login' });
  }
});

module.exports = { router, authenticateToken, requireAdmin };
