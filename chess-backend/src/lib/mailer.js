/**
 * Email utility — Resend SDK (primary) atau Nodemailer SMTP (fallback).
 *
 * Prioritas:
 *   1. RESEND_API_KEY   → Resend SDK
 *   2. SMTP_HOST + SMTP_USER + SMTP_PASS → Nodemailer SMTP
 *   3. Tidak ada config → log ke console (dev mode)
 *
 * Functions:
 *   sendVerificationEmail(email, username, token)
 *   sendPasswordResetEmail(email, username, token)
 */

const nodemailer = require('nodemailer');

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const SMTP_CONFIGURED = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

if (!RESEND_API_KEY && !SMTP_CONFIGURED) {
  console.warn('[Mailer] ⚠️  Email TIDAK dikonfigurasi — email TIDAK AKAN terkirim!');
  console.warn('[Mailer]    Set RESEND_API_KEY (direkomendasikan) atau SMTP_HOST + SMTP_USER + SMTP_PASS.');
  console.warn('[Mailer]    Resend gratis: https://resend.com (100 email/hari).');
} else if (RESEND_API_KEY) {
  console.info('[Mailer] Menggunakan Resend SDK.');
} else {
  console.info('[Mailer] Menggunakan Nodemailer SMTP.');
}

const FROM_NAME  = 'Chess Arena';
const FROM_EMAIL = process.env.RESEND_FROM || process.env.SMTP_FROM || 'noreply@chess-arena.app';
const BASE_URL   = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── Resend client (lazy init) ─────────────────────────────────────────────────
let _resend = null;
function getResend() {
  if (_resend) return _resend;
  if (!RESEND_API_KEY) return null;
  const { Resend } = require('resend');
  _resend = new Resend(RESEND_API_KEY);
  return _resend;
}

// ── Nodemailer transporter (lazy init) ────────────────────────────────────────
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (!SMTP_CONFIGURED) return null;
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

// ── Email Templates (Bahasa Indonesia) ───────────────────────────────────────

function verificationEmailHtml(username, verifyUrl) {
  return `
    <!DOCTYPE html>
    <html lang="id">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0; padding:0; background:#0a0f1e; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e; padding:40px 16px;">
        <tr><td align="center">
          <table width="100%" style="max-width:520px; background:#0f172a; border-radius:16px; border:1px solid #1e293b; overflow:hidden;">
            <!-- Header -->
            <tr>
              <td style="background:linear-gradient(135deg,#0ea5e9,#3b82f6); padding:32px; text-align:center;">
                <div style="font-size:36px; margin-bottom:8px;">♟</div>
                <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:900; letter-spacing:-0.5px;">Chess Arena</h1>
                <p style="margin:4px 0 0; color:rgba(255,255,255,0.8); font-size:13px;">Platform Catur Kompetitif</p>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:32px 32px 24px;">
                <h2 style="margin:0 0 12px; color:#f1f5f9; font-size:20px; font-weight:700;">Verifikasi Email Kamu 👋</h2>
                <p style="margin:0 0 20px; color:#94a3b8; font-size:15px; line-height:1.7;">
                  Halo <strong style="color:#e2e8f0;">${username}</strong>, selamat bergabung di Chess Arena!<br>
                  Klik tombol di bawah untuk mengaktifkan akunmu.
                </p>
                <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:10px; background:linear-gradient(135deg,#0ea5e9,#3b82f6);">
                      <a href="${verifyUrl}"
                         style="display:inline-block; padding:14px 32px; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; border-radius:10px;">
                        ✅ Verifikasi Email
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px; color:#64748b; font-size:13px; line-height:1.5;">
                  Atau salin link berikut ke browser:
                </p>
                <p style="margin:0 0 24px; word-break:break-all;">
                  <a href="${verifyUrl}" style="color:#38bdf8; font-size:13px;">${verifyUrl}</a>
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:20px 32px 28px; border-top:1px solid #1e293b;">
                <p style="margin:0; color:#475569; font-size:12px; line-height:1.6;">
                  Link ini berlaku selama <strong style="color:#64748b;">24 jam</strong>.<br>
                  Jika kamu tidak mendaftar di Chess Arena, abaikan email ini.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0; color:#334155; font-size:12px;">© 2025 Chess Arena. Semua hak dilindungi.</p>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

function resetPasswordEmailHtml(username, resetUrl) {
  return `
    <!DOCTYPE html>
    <html lang="id">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0; padding:0; background:#0a0f1e; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e; padding:40px 16px;">
        <tr><td align="center">
          <table width="100%" style="max-width:520px; background:#0f172a; border-radius:16px; border:1px solid #1e293b; overflow:hidden;">
            <!-- Header -->
            <tr>
              <td style="background:linear-gradient(135deg,#f97316,#ef4444); padding:32px; text-align:center;">
                <div style="font-size:36px; margin-bottom:8px;">♟</div>
                <h1 style="margin:0; color:#ffffff; font-size:24px; font-weight:900; letter-spacing:-0.5px;">Chess Arena</h1>
                <p style="margin:4px 0 0; color:rgba(255,255,255,0.8); font-size:13px;">Platform Catur Kompetitif</p>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:32px 32px 24px;">
                <h2 style="margin:0 0 12px; color:#f1f5f9; font-size:20px; font-weight:700;">Reset Password 🔐</h2>
                <p style="margin:0 0 20px; color:#94a3b8; font-size:15px; line-height:1.7;">
                  Halo <strong style="color:#e2e8f0;">${username}</strong>,<br>
                  Kami menerima permintaan reset password untuk akunmu. Klik tombol di bawah untuk membuat password baru.
                </p>
                <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:10px; background:linear-gradient(135deg,#f97316,#ef4444);">
                      <a href="${resetUrl}"
                         style="display:inline-block; padding:14px 32px; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; border-radius:10px;">
                        🔑 Reset Password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px; color:#64748b; font-size:13px; line-height:1.5;">
                  Atau salin link berikut ke browser:
                </p>
                <p style="margin:0 0 24px; word-break:break-all;">
                  <a href="${resetUrl}" style="color:#38bdf8; font-size:13px;">${resetUrl}</a>
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:20px 32px 28px; border-top:1px solid #1e293b;">
                <p style="margin:0; color:#475569; font-size:12px; line-height:1.6;">
                  Link ini berlaku selama <strong style="color:#64748b;">1 jam</strong>.<br>
                  Jika kamu tidak meminta reset password, abaikan email ini — password kamu tidak akan berubah.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0; color:#334155; font-size:12px;">© 2025 Chess Arena. Semua hak dilindungi.</p>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

// ── Core send function ────────────────────────────────────────────────────────

async function sendMail({ to, subject, html, text }) {
  const resend = getResend();

  // 1. Resend SDK
  if (resend) {
    const { error } = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to,
      subject,
      html,
      text,
    });
    if (error) throw new Error(`Resend error: ${error.message}`);
    console.info(`[Mailer] Email terkirim via Resend: "${subject}" → ${to}`);
    return;
  }

  // 2. Nodemailer SMTP fallback
  const transporter = getTransporter();
  if (transporter) {
    await transporter.sendMail({ from: `"${FROM_NAME}" <${FROM_EMAIL}>`, to, subject, html, text });
    console.info(`[Mailer] Email terkirim via SMTP: "${subject}" → ${to}`);
    return;
  }

  // 3. Dev fallback — log to console
  console.info('[Mailer] Email tidak dikirim (tidak ada config). Preview:');
  console.info(`  To:      ${to}`);
  console.info(`  Subject: ${subject}`);
  console.info(`  Body:    ${text}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Kirim email verifikasi setelah registrasi.
 * @param {string} email
 * @param {string} username
 * @param {string} token  - 32-byte hex token (plain, sebelum di-hash)
 */
async function sendVerificationEmail(email, username, token) {
  const verifyUrl = `${BASE_URL}/verify-email?token=${token}`;
  await sendMail({
    to: email,
    subject: 'Verifikasi email Chess Arena kamu',
    html: verificationEmailHtml(username, verifyUrl),
    text: `Halo ${username},\n\nVerifikasi email kamu dengan membuka link berikut:\n${verifyUrl}\n\nLink berlaku 24 jam. Jika kamu tidak mendaftar, abaikan email ini.`,
  });
}

/**
 * Kirim email reset password.
 * @param {string} email
 * @param {string} username
 * @param {string} token  - 32-byte hex token (plain, sebelum di-hash)
 */
async function sendPasswordResetEmail(email, username, token) {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`;
  await sendMail({
    to: email,
    subject: 'Reset password Chess Arena kamu',
    html: resetPasswordEmailHtml(username, resetUrl),
    text: `Halo ${username},\n\nReset password kamu dengan membuka link berikut:\n${resetUrl}\n\nLink berlaku 1 jam. Jika kamu tidak meminta reset password, abaikan email ini.`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
