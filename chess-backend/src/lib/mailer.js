/**
 * Email utility using Nodemailer.
 * Requires SMTP_* environment variables (see .env.example).
 *
 * Functions:
 *   sendVerificationEmail(email, username, token)
 *   sendPasswordResetEmail(email, username, token)
 *
 * If SMTP is not configured, emails are logged to console in dev mode.
 */

const nodemailer = require('nodemailer');

// Build transporter lazily so missing SMTP config doesn't crash startup
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // Not configured
  }

  _transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   parseInt(SMTP_PORT || '587'),
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return _transporter;
}

const FROM_NAME  = 'Chess Arena';
const FROM_EMAIL = process.env.SMTP_USER || 'noreply@chess-arena.app';
const BASE_URL   = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Send email verification link after registration.
 * @param {string} email
 * @param {string} username
 * @param {string} token  - 32-byte hex verification token
 */
async function sendVerificationEmail(email, username, token) {
  const verifyUrl = `${BASE_URL}/verify-email?token=${token}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #e2e8f0; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="font-size: 28px; font-weight: 900; color: #38bdf8; margin: 0;">♟ Chess Arena</h1>
      </div>
      <h2 style="color: #f1f5f9; font-size: 20px; margin-bottom: 8px;">Verify your email</h2>
      <p style="color: #94a3b8; margin-bottom: 24px; line-height: 1.6;">
        Hi <strong style="color: #e2e8f0;">${username}</strong>, thanks for signing up!
        Please click the button below to verify your email address.
      </p>
      <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #0ea5e9, #3b82f6); color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; font-size: 15px; margin-bottom: 24px;">
        Verify Email
      </a>
      <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
        Or copy this link:<br>
        <a href="${verifyUrl}" style="color: #38bdf8; word-break: break-all;">${verifyUrl}</a>
      </p>
      <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #1e293b; padding-top: 16px;">
        This link expires in 24 hours. If you didn't create an account, you can ignore this email.
      </p>
    </div>
  `;

  await sendMail({
    to: email,
    subject: 'Verify your Chess Arena email',
    html,
    text: `Hi ${username},\n\nPlease verify your email by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
}

/**
 * Send password reset link.
 * @param {string} email
 * @param {string} username
 * @param {string} token  - 32-byte hex reset token (expires 1 hour)
 */
async function sendPasswordResetEmail(email, username, token) {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #0f172a; color: #e2e8f0; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="font-size: 28px; font-weight: 900; color: #38bdf8; margin: 0;">♟ Chess Arena</h1>
      </div>
      <h2 style="color: #f1f5f9; font-size: 20px; margin-bottom: 8px;">Reset your password</h2>
      <p style="color: #94a3b8; margin-bottom: 24px; line-height: 1.6;">
        Hi <strong style="color: #e2e8f0;">${username}</strong>, we received a request to reset your password.
        Click the button below to set a new password.
      </p>
      <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #f97316, #ef4444); color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; font-size: 15px; margin-bottom: 24px;">
        Reset Password
      </a>
      <p style="color: #64748b; font-size: 13px; line-height: 1.5;">
        Or copy this link:<br>
        <a href="${resetUrl}" style="color: #38bdf8; word-break: break-all;">${resetUrl}</a>
      </p>
      <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #1e293b; padding-top: 16px;">
        This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your password won't change.
      </p>
    </div>
  `;

  await sendMail({
    to: email,
    subject: 'Reset your Chess Arena password',
    html,
    text: `Hi ${username},\n\nReset your password at:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
  });
}

/**
 * Internal send helper with console fallback for development.
 */
async function sendMail({ to, subject, html, text }) {
  const transporter = getTransporter();

  if (!transporter) {
    // Dev fallback: log to console
    console.info('[Mailer] SMTP not configured — email would be sent:');
    console.info(`  To:      ${to}`);
    console.info(`  Subject: ${subject}`);
    console.info(`  Body:    ${text}`);
    return;
  }

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    html,
    text,
  });

  console.info(`[Mailer] Email sent: "${subject}" → ${to}`);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
