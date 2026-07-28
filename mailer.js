const nodemailer = require('nodemailer');

const port = parseInt(process.env.SMTP_PORT || '587', 10);

// Configure SMTP transport using process.env variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: port,
  secure: port === 465, // true for port 465 (SSL), false for 587 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Helper to verify SMTP connection on startup
const verifyTransporter = async () => {
  try {
    await transporter.verify();
    console.log('✅ SMTP Mailer is ready to send emails.');
  } catch (error) {
    console.error('❌ SMTP Connection Error:', error.message);
  }
};

// Send OTP Verification Email
const sendVerificationEmail = async (toEmail, otpCode) => {
  const mailOptions = {
    from: `"${process.env.APP_NAME || 'BSC Ticket Platform'}" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Your Account Verification OTP',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0f172a; color: #ffffff; border-radius: 10px; max-width: 500px; margin: auto;">
        <h2 style="color: #10b981; text-align: center;">${process.env.APP_NAME || 'BSC Ticket Platform'}</h2>
        <p>Thank you for signing up! Use the 6-digit verification code below to verify your email address:</p>
        <div style="background-color: #1e293b; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #10b981; padding: 15px; border-radius: 8px; margin: 20px 0;">
          ${otpCode}
        </div>
        <p style="font-size: 12px; color: #94a3b8; text-align: center;">This code will expire shortly. If you did not request this, please ignore this email.</p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};

module.exports = {
  sendVerificationEmail,
  verifyTransporter,
};