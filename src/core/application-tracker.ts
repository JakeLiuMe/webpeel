/**
 * Application Tracker — persists job application records to disk.
 *
 * Stored at: ~/.webpeel/applications.json
 *
 * Features:
 * - Add / update application records
 * - Duplicate-URL detection
 * - Filter by platform, status, or since-date
 * - Quick stats summary (total, by-platform, by-status, this-week, today)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────

export type ApplicationStatus =
  | 'applied'
  | 'saved'
  | 'failed'
  | 'skipped'
  | 'interview'
  | 'rejected'
  | 'offer';

export interface ApplicationRecord {
  /** Unique ID (UUID v4) */
  id: string;
  /** Job URL (canonical, used for duplicate detection) */
  url: string;
  /** Job title */
  title: string;
  /** Company name */
  company: string;
  /** Location string */
  location?: string;
  /** Salary / compensation info */
  salary?: string;
  /** Platform identifier: linkedin, indeed, upwork, etc. */
  platform: string;
  /** Current application status */
  status: ApplicationStatus;
  /** ISO-8601 timestamp of the initial application */
  appliedAt: string;
  /** Cover letter or proposal text used */
  coverLetter?: string;
  /** Answers given to screening questions */
  screeningAnswers?: Record<string, string>;
  /** Error message if the application failed */
  error?: string;
  /** Free-form notes */
  notes?: string;
}

export interface ApplicationFilter {
  platform?: string;
  status?: string;
  /** ISO date string — only return records on or after this date */
  since?: string;
}

export interface ApplicationStats {
  total: number;
  byPlatform: Record<string, number>;
  byStatus: Record<string, number>;
  thisWeek: number;
  today: number;
}

// ── Storage ────────────────────────────────────────────────────────────

const WEBPEEL_DIR = join(homedir(), '.webpeel');
const APPLICATIONS_PATH = join(WEBPEEL_DIR, 'applications.json');

// ── ApplicationTracker class ───────────────────────────────────────────

export class ApplicationTracker {
  private records: ApplicationRecord[];

  constructor() {
    this.records = this.loadRecords();
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Add a new application record.
   * Assigns a random UUID and returns the completed record.
   */
  add(record: Omit<ApplicationRecord, 'id'>): ApplicationRecord {
    const full: ApplicationRecord = {
      id: randomUUID(),
      ...record,
    };
    this.records.push(full);
    this.save();
    return full;
  }

  /**
   * Update the status (and optionally notes) of an existing record.
   * Throws if the ID is not found.
   */
  updateStatus(id: string, status: ApplicationStatus, notes?: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) {
      throw new Error(`Application record not found: ${id}`);
    }
    record.status = status;
    if (notes !== undefined) {
      record.notes = notes;
    }
    this.save();
  }

  /**
   * Return true if there is already an 'applied' record for this URL.
   * Normalises the URL by stripping trailing slashes and query strings that
   * are tracking parameters (utm_*, ref, etc.) before comparison.
   */
  hasApplied(url: string): boolean {
    const norm = normaliseUrl(url);
    return this.records.some(
      (r) => normaliseUrl(r.url) === norm && r.status === 'applied',
    );
  }

  /**
   * Return records, optionally filtered by platform, status, and/or since-date.
   * Results are sorted newest-first.
   */
  list(filter?: ApplicationFilter): ApplicationRecord[] {
    let results = [...this.records];

    if (filter?.platform) {
      const p = filter.platform.toLowerCase();
      results = results.filter((r) => r.platform.toLowerCase() === p);
    }

    if (filter?.status) {
      const s = filter.status.toLowerCase();
      results = results.filter((r) => r.status.toLowerCase() === s);
    }

    if (filter?.since) {
      const sinceTs = Date.parse(filter.since);
      if (!isNaN(sinceTs)) {
        results = results.filter((r) => Date.parse(r.appliedAt) >= sinceTs);
      }
    }

    // Newest first
    results.sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));
    return results;
  }

  /**
   * Return an aggregate stats summary.
   */
  stats(): ApplicationStats {
    const now = new Date();
    const todayStr = toDateString(now);
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoTs = weekAgo.getTime();

    const byPlatform: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let thisWeek = 0;
    let today = 0;

    for (const r of this.records) {
      // Platform counts
      byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + 1;

      // Status counts
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

      // Time-based counts
      const appliedTs = Date.parse(r.appliedAt);
      if (!isNaN(appliedTs)) {
        if (appliedTs >= weekAgoTs) thisWeek++;
        if (toDateString(new Date(appliedTs)) === todayStr) today++;
      }
    }

    return {
      total: this.records.length,
      byPlatform,
      byStatus,
      thisWeek,
      today,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private loadRecords(): ApplicationRecord[] {
    try {
      if (existsSync(APPLICATIONS_PATH)) {
        const raw = readFileSync(APPLICATIONS_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as ApplicationRecord[];
      }
    } catch {
      // Corrupt / missing data — start fresh
    }
    return [];
  }

  private save(): void {
    try {
      mkdirSync(WEBPEEL_DIR, { recursive: true });
      writeFileSync(APPLICATIONS_PATH, JSON.stringify(this.records, null, 2), 'utf-8');
    } catch (err) {
      console.error('[application-tracker] Failed to save records:', err);
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD in local time. */
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Tracking parameters to strip before URL comparison. */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'referer', 'referrer', 'source', 'trk', 'trackingId',
]);

/**
 * Strip trailing slashes, fragments, and common tracking query parameters
 * from a URL for stable duplicate detection.
 */
function normaliseUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    for (const param of TRACKING_PARAMS) {
      u.searchParams.delete(param);
    }
    // Sort remaining params for canonical ordering
    u.searchParams.sort();
    let result = u.toString();
    // Strip trailing slash
    if (result.endsWith('/')) result = result.slice(0, -1);
    return result.toLowerCase();
  } catch {
    // Not a valid URL — return as-is lowercased
    return rawUrl.toLowerCase().replace(/\/$/, '');
  }
}
