/**
 * WebPeel Profile Management
 *
 * Manages named browser profiles stored in ~/.webpeel/profiles/<name>/
 * Each profile contains:
 *   - storage-state.json  (Playwright storage state: cookies, localStorage, origins)
 *   - metadata.json       (name, created, lastUsed, domains, description)
 */

import { chromium } from 'playwright';
import { homedir } from 'os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProfileMetadata {
  name: string;
  created: string;   // ISO date
  lastUsed: string;  // ISO date
  domains: string[]; // domains the user logged into during setup
  description?: string;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const PROFILES_DIR = path.join(homedir(), '.webpeel', 'profiles');

function ensureProfilesDir(): void {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

// ─── Name validation ─────────────────────────────────────────────────────────

/**
 * Valid profile names: letters, digits, hyphens only. No spaces or special chars.
 */
export function isValidProfileName(name: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(name) && name.length > 0 && name.length <= 64;
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Get the directory path for a named profile, or null if it doesn't exist.
 */
export function getProfilePath(name: string): string | null {
  const dir = path.join(PROFILES_DIR, name);
  if (existsSync(dir) && existsSync(path.join(dir, 'metadata.json'))) {
    return dir;
  }
  return null;
}

/**
 * Load the Playwright storage state (cookies + localStorage) for a named profile.
 * Returns null if the profile or storage-state.json doesn't exist.
 */
export function loadStorageState(name: string): any | null {
  const statePath = path.join(PROFILES_DIR, name, 'storage-state.json');
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update the lastUsed timestamp for a profile.
 */
export function touchProfile(name: string): void {
  const metaPath = path.join(PROFILES_DIR, name, 'metadata.json');
  if (!existsSync(metaPath)) return;
  try {
    const meta: ProfileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.lastUsed = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    /* ignore */
  }
}

/**
 * List all profiles, sorted by lastUsed descending.
 */
export function listProfiles(): ProfileMetadata[] {
  ensureProfilesDir();
  const profiles: ProfileMetadata[] = [];
  try {
    const entries = readdirSync(PROFILES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(PROFILES_DIR, entry.name, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      try {
        const meta: ProfileMetadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
        profiles.push(meta);
      } catch {
        /* skip corrupt profile */
      }
    }
  } catch {
    /* ignore read errors */
  }
  // Sort: most recently used first
  profiles.sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
  return profiles;
}

/**
 * Delete a named profile. Returns true if deleted, false if not found.
 */
export function deleteProfile(name: string): boolean {
  const dir = path.join(PROFILES_DIR, name);
  if (!existsSync(dir)) return false;
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ─── Interactive profile creation ─────────────────────────────────────────────

/**
 * Interactively create a new profile:
 * 1. Launches a VISIBLE (headed) Chromium browser
 * 2. User navigates and logs into sites
 * 3. On browser close or Ctrl+C, captures storage state and saves the profile
 */
export async function createProfile(name: string, description?: string): Promise<void> {
  if (!isValidProfileName(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use only letters, numbers, and hyphens (no spaces or special characters).`,
    );
  }

  ensureProfilesDir();

  const profileDir = path.join(PROFILES_DIR, name);
  if (existsSync(profileDir)) {
    throw new Error(
      `Profile "${name}" already exists. Delete it first with:\n  webpeel profile delete ${name}`,
    );
  }

  mkdirSync(profileDir, { recursive: true });

  // Launch headed (visible) Chromium — no user-data-dir so we start fresh
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('about:blank').catch(() => {});

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log(`║  WebPeel Profile Setup: "${name}"`);
  console.log('║                                                      ║');
  console.log('║  Navigate to websites and log in.                   ║');
  console.log('║  When done, press Ctrl+C or close this window.      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  let saved = false;

  const saveAndClose = async (): Promise<void> => {
    if (saved) return;
    saved = true;

    console.log('\nCapturing browser session...');

    try {
      const storageState = await context.storageState();

      writeFileSync(
        path.join(profileDir, 'storage-state.json'),
        JSON.stringify(storageState, null, 2),
      );

      // Extract unique domains from cookies (strip leading dot)
      const domains: string[] = [
        ...new Set(
          (storageState.cookies ?? [])
            .map((c: any) => (c.domain ?? '').replace(/^\./, ''))
            .filter(Boolean),
        ),
      ];

      const now = new Date().toISOString();
      const meta: ProfileMetadata = {
        name,
        created: now,
        lastUsed: now,
        domains,
        ...(description ? { description } : {}),
      };

      writeFileSync(
        path.join(profileDir, 'metadata.json'),
        JSON.stringify(meta, null, 2),
      );

      console.log(`✓ Profile "${name}" saved to ${profileDir}`);
      if (domains.length > 0) {
        console.log(`  Domains: ${domains.join(', ')}`);
      } else {
        console.log('  No login sessions detected (no cookies).');
      }
    } catch (e) {
      console.error(
        'Warning: Failed to save storage state:',
        e instanceof Error ? e.message : String(e),
      );
      // Clean up partial directory
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    try {
      await browser.close();
    } catch {
      /* ignore — browser may already be closed */
    }
  };

  // Wait for the browser to disconnect (user closed the window) OR SIGINT (Ctrl+C)
  await new Promise<void>((resolve) => {
    browser.on('disconnected', async () => {
      await saveAndClose();
      resolve();
    });

    // Handle Ctrl+C gracefully
    const sigintHandler = async () => {
      await saveAndClose();
      resolve();
    };
    process.once('SIGINT', sigintHandler);

    // Clean up the SIGINT handler if browser closes first
    browser.on('disconnected', () => {
      process.removeListener('SIGINT', sigintHandler);
    });
  });
}
