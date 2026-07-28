const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('./db');
const sendVerificationEmail = require('./mailer');

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

// SIGNUP
router.post('/register', async (req, res) => {
  try {
    const { email, password, confirmPassword, referralCode } = req.body;

    if (!email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    // 1. Check Passwords Match
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match!' });
    }

    // 2. Enforce Password Policy
    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long and contain an uppercase letter, lowercase letter, number, and special character (@$!%*?&).'
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 3. Check existing user
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered. Please log in!' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Handle Sponsor/Referral Link
    let sponsorId = null;
    if (referralCode && referralCode.trim() !== '') {
      const parentUser = await prisma.user.findUnique({
        where: { referralCode: referralCode.trim() }
      });
      if (parentUser) {
        sponsorId = parentUser.id;
      }
    }

    // Generate 6-digit OTP & Expiry (10 minutes)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins from now
    const userReferralCode = await generateUniqueReferralCode();

    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        password: hashedPassword,
        sponsorId,
        referralCode: userReferralCode,
        verificationCode,
        otpExpiresAt,
        isVerified: false
      }
    });

    // Send OTP email using Nodemailer
    try {
      await sendVerificationEmail(cleanEmail, verificationCode);
    } catch (mailErr) {
      console.error('Email sending failed:', mailErr);
    }

    res.status(201).json({
      message: 'Account created! A 6-digit OTP code has been sent to your email address (valid for 10 minutes).',
      email: user.email
    });
  } catch (error) {
    console.error('SIGNUP ERROR LOG:', error);
    res.status(500).json({ error: error.message || 'Server error during signup' });
  }
});

// VERIFY EMAIL OTP
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || code === undefined || code === null) {
      return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (!user) {
      return res.status(404).json({ error: `User with email ${cleanEmail} not found.` });
    }

    console.log(`[VERIFY OTP] DB Code: "${user.verificationCode}" | Received Code: "${cleanCode}"`);

    if (String(user.verificationCode).trim() !== cleanCode) {
      return res.status(400).json({ 
        error: 'Invalid verification code. Please check and try again.',
        debug: `Expected: ${user.verificationCode}, Received: ${cleanCode}` // Temporary debug line
      });
    }

    // Check OTP Expiry
    if (user.otpExpiresAt && new Date() > new Date(user.otpExpiresAt)) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    // Mark user as verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationCode: null,
        otpExpiresAt: null
      }
    });

    res.json({ message: 'Email verified successfully! You can now log in.' });
  } catch (error) {
    console.error('VERIFICATION ERROR:', error);
    res.status(500).json({ error: 'Email verification failed: ' + error.message });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ error: 'Your email is not verified yet. Please verify first!' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        referralCode: user.referralCode,
        fundingWallet: user.fundingWallet,
        earningWallet: user.earningWallet,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('LOGIN ERROR LOG:', error);
    res.status(500).json({ error: error.message || 'Server error during login' });
  }
});

module.exports = { router, authenticateToken, requireAdmin };
