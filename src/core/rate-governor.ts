/**
 * Rate Governor — controls application rate to stay within safe limits.
 *
 * Prevents over-application and bot-detection triggers by:
 * - Capping daily application count
 * - Enforcing minimum/maximum delays between applications
 * - Restricting activity to configured active hours
 * - Supporting optional weekday-only mode
 * - Entering cooldown after a CAPTCHA / warning signal is detected
 *
 * State is persisted to ~/.webpeel/rate-state.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Interfaces ─────────────────────────────────────────────────────────

export interface RateConfig {
  /** Max applications per day. Default: 5 */
  maxPerDay: number;
  /** Min delay between applications in ms. Default: 900000 (15 min) */
  minDelayMs: number;
  /** Max delay between applications in ms. Default: 2700000 (45 min) */
  maxDelayMs: number;
  /** Active hours range [start, end] in 24h format. Default: [9, 18] */
  activeHours: [number, number];
  /** Only apply on weekdays. Default: true */
  weekdaysOnly: boolean;
  /** Cooldown period after CAPTCHA/warning detection in ms. Default: 172800000 (48h) */
  warningCooldownMs: number;
}

export interface RateState {
  /** Applications submitted today (resets at midnight) */
  todayCount: number;
  /** Date string (YYYY-MM-DD) for today tracking */
  todayDate: string;
  /** Timestamp of last application */
  lastApplyTimestamp: number;
  /** Timestamp when cooldown expires (0 if no cooldown) */
  cooldownUntil: number;
  /** Total applications all time */
  totalApplications: number;
}

export interface CanApplyResult {
  allowed: boolean;
  reason?: string;
  /** Milliseconds to wait before trying again */
  waitMs?: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: RateConfig = {
  maxPerDay: 5,
  minDelayMs: 900_000,      // 15 minutes
  maxDelayMs: 2_700_000,    // 45 minutes
  activeHours: [9, 18],
  weekdaysOnly: true,
  warningCooldownMs: 172_800_000, // 48 hours
};

const WEBPEEL_DIR = join(homedir(), '.webpeel');
const RATE_STATE_PATH = join(WEBPEEL_DIR, 'rate-state.json');

// ── Helpers ────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD in local time */
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Milliseconds until the next occurrence of a given hour (local time) */
function msUntilHour(hour: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/** Milliseconds until next weekday morning (Monday 9am) */
function msUntilNextWeekdayMorning(startHour: number): number {
  const now = new Date();
  const target = new Date(now);

  // Step forward day by day until we hit a weekday
  for (let i = 1; i <= 7; i++) {
    target.setDate(now.getDate() + i);
    target.setHours(startHour, 0, 0, 0);
    const dow = target.getDay(); // 0=Sun, 6=Sat
    if (dow >= 1 && dow <= 5) break;
  }

  return target.getTime() - now.getTime();
}

// ── RateGovernor class ─────────────────────────────────────────────────

export class RateGovernor {
  private config: RateConfig;
  private state: RateState;

  constructor(config?: Partial<RateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.loadState();
    this.maybeResetDay();
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Check whether we are allowed to submit an application right now.
   * Returns `{ allowed: true }` if all checks pass, otherwise returns
   * `{ allowed: false, reason, waitMs }`.
   */
  canApply(): CanApplyResult {
    const now = Date.now();
    const nowDate = new Date();

    // 1. Active cooldown check
    if (this.state.cooldownUntil > 0 && now < this.state.cooldownUntil) {
      const waitMs = this.state.cooldownUntil - now;
      return {
        allowed: false,
        reason: `Warning cooldown active — resumes in ${formatDuration(waitMs)}`,
        waitMs,
      };
    }

    // 2. Weekday-only check
    if (this.config.weekdaysOnly) {
      const dow = nowDate.getDay(); // 0=Sun, 6=Sat
      if (dow === 0 || dow === 6) {
        const waitMs = msUntilNextWeekdayMorning(this.config.activeHours[0]);
        return {
          allowed: false,
          reason: 'Weekday-only mode — today is a weekend',
          waitMs,
        };
      }
    }

    // 3. Active hours check
    const [startHour, endHour] = this.config.activeHours;
    const currentHour = nowDate.getHours();
    if (currentHour < startHour) {
      const waitMs = msUntilHour(startHour);
      return {
        allowed: false,
        reason: `Outside active hours — active between ${startHour}:00 and ${endHour}:00`,
        waitMs,
      };
    }
    if (currentHour >= endHour) {
      // Past today's window; next window is tomorrow morning
      const waitMs = msUntilHour(startHour) + 0; // already points to tomorrow
      return {
        allowed: false,
        reason: `Outside active hours — active between ${startHour}:00 and ${endHour}:00`,
        waitMs,
      };
    }

    // 4. Daily cap check
    if (this.state.todayCount >= this.config.maxPerDay) {
      const waitMs = msUntilHour(startHour); // Try again tomorrow
      return {
        allowed: false,
        reason: `Daily limit reached (${this.config.maxPerDay} applications today)`,
        waitMs,
      };
    }

    // 5. Minimum delay between applications
    if (this.state.lastApplyTimestamp > 0) {
      const elapsed = now - this.state.lastApplyTimestamp;
      if (elapsed < this.config.minDelayMs) {
        const waitMs = this.config.minDelayMs - elapsed;
        return {
          allowed: false,
          reason: `Minimum delay not elapsed — please wait ${formatDuration(waitMs)}`,
          waitMs,
        };
      }
    }

    return { allowed: true };
  }

  /** Record a successful application submission. */
  recordApplication(): void {
    this.maybeResetDay();
    this.state.todayCount += 1;
    this.state.lastApplyTimestamp = Date.now();
    this.state.totalApplications += 1;
    this.saveState();
  }

  /**
   * Record a warning signal (CAPTCHA detected, rate-limit notice, etc.).
   * Activates a cooldown period to avoid further detection.
   */
  recordWarning(): void {
    this.state.cooldownUntil = Date.now() + this.config.warningCooldownMs;
    this.saveState();
  }

  /** Get a snapshot of the current rate state. */
  getState(): RateState {
    this.maybeResetDay();
    return { ...this.state };
  }

  /** Manually clear the active cooldown. */
  resetCooldown(): void {
    this.state.cooldownUntil = 0;
    this.saveState();
  }

  /**
   * Calculate a randomised delay for the next application submission.
   * Returns a value uniformly distributed between minDelayMs and maxDelayMs.
   */
  getNextDelay(): number {
    const range = this.config.maxDelayMs - this.config.minDelayMs;
    return Math.floor(this.config.minDelayMs + Math.random() * range);
  }

  /** Expose resolved config (useful for CLI display). */
  getConfig(): RateConfig {
    return { ...this.config };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /** Reset today's counter if the calendar date has changed. */
  private maybeResetDay(): void {
    const today = toDateString(new Date());
    if (this.state.todayDate !== today) {
      this.state.todayCount = 0;
      this.state.todayDate = today;
      this.saveState();
    }
  }

  private loadState(): RateState {
    try {
      if (existsSync(RATE_STATE_PATH)) {
        const raw = readFileSync(RATE_STATE_PATH, 'utf-8');
        return JSON.parse(raw) as RateState;
      }
    } catch {
      // Corrupt / missing state — start fresh
    }
    return this.freshState();
  }

  private freshState(): RateState {
    return {
      todayCount: 0,
      todayDate: toDateString(new Date()),
      lastApplyTimestamp: 0,
      cooldownUntil: 0,
      totalApplications: 0,
    };
  }

  private saveState(): void {
    try {
      mkdirSync(WEBPEEL_DIR, { recursive: true });
      writeFileSync(RATE_STATE_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      // Non-fatal — state will be recomputed on next run
      console.error('[rate-governor] Failed to save state:', err);
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────────

/** Human-readable duration string from milliseconds. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
