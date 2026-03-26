/**
 * Email service using Nodemailer (free, no API key required).
 * Configure via environment variables:
 *   EMAIL_SMTP_HOST - SMTP server (e.g. smtp.gmail.com)
 *   EMAIL_SMTP_PORT - SMTP port (default: 587)
 *   EMAIL_SMTP_USER - SMTP username / email address
 *   EMAIL_SMTP_PASS - SMTP password (Gmail: use App Password)
 *   EMAIL_FROM      - From address (default: EMAIL_SMTP_USER)
 *
 * Gmail setup: https://myaccount.google.com/apppasswords
 * Use "App Password" (not your regular password).
 */

import nodemailer from 'nodemailer';
import type { Pool as PgPool } from 'pg';

function createTransport() {
  const host = process.env.EMAIL_SMTP_HOST;
  const user = process.env.EMAIL_SMTP_USER;
  const pass = process.env.EMAIL_SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
    secure: process.env.EMAIL_SMTP_PORT === '465',
    auth: { user, pass },
  });
}

export interface UsageAlertEmailParams {
  toEmail: string;
  userName?: string;
  usagePercent: number;
  used: number;
  total: number;
  tier: string;
}

export async function sendUsageAlertEmail(params: UsageAlertEmailParams): Promise<boolean> {
  const transport = createTransport();
  if (!transport) {
    console.warn('[email] SMTP not configured. Set EMAIL_SMTP_HOST, EMAIL_SMTP_USER, EMAIL_SMTP_PASS to enable email alerts.');
    return false;
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;
  const html = buildUsageAlertHtml(params);

  try {
    await transport.sendMail({
      from: `WebPeel <${from}>`,
      to: params.toEmail,
      subject: `WebPeel: You've used ${params.usagePercent}% of your weekly API limit`,
      html,
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send usage alert:', err);
    return false;
  }
}

function buildUsageAlertHtml(params: UsageAlertEmailParams): string {
  const { usagePercent, used, total, tier, userName } = params;
  const color = usagePercent >= 90 ? '#ef4444' : usagePercent >= 75 ? '#f59e0b' : '#5865F2';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WebPeel Usage Alert</title></head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#111116;border:1px solid #27272a;border-radius:12px;overflow:hidden;">
    <div style="background:${color};padding:4px 24px;"></div>
    <div style="padding:32px 24px;">
      <div style="font-size:24px;font-weight:700;color:#ffffff;margin-bottom:8px;">Usage Alert</div>
      <div style="font-size:15px;color:#a1a1aa;margin-bottom:24px;">
        ${userName ? `Hi ${userName}, you've` : "You've"} used <strong style="color:#ffffff;">${usagePercent}%</strong> of your weekly API limit.
      </div>
      <div style="background:#18181b;border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="font-size:13px;color:#a1a1aa;margin-bottom:8px;">Usage this week</div>
        <div style="height:8px;background:#27272a;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(usagePercent,100)}%;background:${color};border-radius:4px;"></div>
        </div>
        <div style="font-size:13px;color:#a1a1aa;margin-top:8px;">${used} / ${total} requests · ${tier} plan</div>
      </div>
      <a href="https://app.webpeel.dev/billing" style="display:inline-block;background:#5865F2;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Upgrade Plan →</a>
      <div style="font-size:12px;color:#71717a;margin-top:24px;">
        To disable these alerts, visit <a href="https://app.webpeel.dev/settings" style="color:#5865F2;">Settings</a>.
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Dual-threshold automatic alert system (80% and 90%)
// ---------------------------------------------------------------------------

/** Week string in "YYYY-Www" format, consistent with pg-auth-store */
function getCurrentWeek(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekNum = Math.ceil(
    ((now.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7
  );
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/** Returns true if the timestamp is within the current ISO week */
function isSentThisWeek(ts: Date | null): boolean {
  if (!ts) return false;
  const now = new Date();
  // Start of current week (Monday 00:00 UTC)
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysToMonday));
  return ts >= weekStart;
}

export interface UsageAlertCheckResult {
  /**
   * Which threshold was crossed (80 | 90), or null if no alert to send.
   * Priority: 90 > 80 (only one alert per call).
   */
  threshold: 80 | 90 | null;
  usagePercent: number;
  used: number;
  total: number;
  userEmail: string;
  userName?: string;
  userTier: string;
  /** Custom alert email if set, otherwise falls back to userEmail */
  alertEmail: string;
}

/**
 * Check whether a usage alert should be sent for a given user and,
 * if so, return the alert details plus automatically update the
 * `alert_sent_80_at` / `alert_sent_90_at` column.
 *
 * Thresholds are **automatic** (80% and 90%) and work independently of
 * the user-configured `alert_threshold` system.
 *
 * Call this fire-and-forget style after each successful API request:
 *   ```ts
 *   checkAndSendDualAlert(pool, userId).catch(() => {});
 *   ```
 */
export async function checkAndSendDualAlert(
  pool: PgPool,
  userId: string
): Promise<void> {
  try {
    const currentWeek = getCurrentWeek();

    const result = await pool.query(
      `SELECT u.email, u.name, u.tier, u.alert_email,
              u.alert_sent_80_at, u.alert_sent_90_at,
              u.weekly_limit,
              COALESCE(SUM(wu.total_count), 0) AS total_used,
              u.weekly_limit + COALESCE(MAX(wu.rollover_credits), 0) AS total_available
       FROM users u
       LEFT JOIN api_keys ak ON ak.user_id = u.id
       LEFT JOIN weekly_usage wu ON wu.api_key_id = ak.id AND wu.week = $2
       WHERE u.id = $1
       GROUP BY u.id, u.email, u.name, u.tier, u.alert_email,
                u.alert_sent_80_at, u.alert_sent_90_at, u.weekly_limit`,
      [userId, currentWeek]
    );

    const row = result.rows[0];
    if (!row) return;

    const used = parseInt(row.total_used, 10) || 0;
    const total = parseInt(row.total_available, 10) || row.weekly_limit || 999;
    const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0;
    const alertEmail: string = row.alert_email || row.email;

    const sharedParams = {
      toEmail: alertEmail,
      userName: row.name || undefined,
      used,
      total,
      tier: row.tier as string,
    };

    // Check 90% threshold first (higher priority)
    if (usagePercent >= 90 && !isSentThisWeek(row.alert_sent_90_at ? new Date(row.alert_sent_90_at) : null)) {
      const sent = await sendUsageAlertEmail({ ...sharedParams, usagePercent: 90 });
      if (sent) {
        await pool.query(
          'UPDATE users SET alert_sent_90_at = NOW() WHERE id = $1',
          [userId]
        );
        console.log(`[alert] Sent 90% usage alert to ${alertEmail} (user ${userId})`);
      }
      return; // Only one alert per call
    }

    // Check 80% threshold (lower priority — don't send if already sent 90%)
    if (usagePercent >= 80 && !isSentThisWeek(row.alert_sent_80_at ? new Date(row.alert_sent_80_at) : null)) {
      const sent = await sendUsageAlertEmail({ ...sharedParams, usagePercent: 80 });
      if (sent) {
        await pool.query(
          'UPDATE users SET alert_sent_80_at = NOW() WHERE id = $1',
          [userId]
        );
        console.log(`[alert] Sent 80% usage alert to ${alertEmail} (user ${userId})`);
      }
    }
  } catch (err) {
    // Never let alert errors surface to callers
    console.warn('[alert] checkAndSendDualAlert failed:', err);
  }
}

/**
 * Send password reset email with a secure reset link.
 */
export async function sendPasswordResetEmail(toEmail: string, resetUrl: string): Promise<boolean> {
  const transport = createTransport();
  if (!transport) {
    console.warn('[email] SMTP not configured. Password reset email not sent to:', toEmail);
    console.warn('[email] Reset URL:', resetUrl); // Log so admin can manually share
    return false;
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_SMTP_USER;

  try {
    await transport.sendMail({
      from: `WebPeel <${from}>`,
      to: toEmail,
      subject: 'Reset your WebPeel password',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #f4f4f5; font-size: 24px; margin: 0;">WebPeel</h1>
          </div>
          <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px;">
            <h2 style="color: #f4f4f5; font-size: 20px; margin: 0 0 16px;">Reset your password</h2>
            <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
              We received a request to reset your WebPeel password. Click the button below to create a new password. This link expires in 1 hour.
            </p>
            <a href="${resetUrl}" style="display: inline-block; background: #5865F2; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
              Reset Password
            </a>
            <p style="color: #71717a; font-size: 12px; margin: 24px 0 0;">
              If you didn't request this, you can safely ignore this email.
            </p>
          </div>
          <p style="color: #52525b; font-size: 11px; text-align: center; margin-top: 24px;">
            © ${new Date().getFullYear()} WebPeel · <a href="https://webpeel.dev" style="color: #52525b;">webpeel.dev</a>
          </p>
        </div>
      `,
    });
    console.log('[email] Password reset email sent to:', toEmail);
    return true;
  } catch (err) {
    console.error('[email] Failed to send password reset email:', err);
    return false;
  }
}
