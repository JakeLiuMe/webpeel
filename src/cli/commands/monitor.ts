/**
 * Monitor command: content change detection for URLs
 *
 * Usage:
 *   webpeel monitor <url>                    - Fetch & snapshot (or diff if prev exists)
 *   webpeel monitor <url> --interval 300     - Watch mode: re-check every 5 minutes
 *   webpeel monitor <url> --json             - JSON output for automation
 *   webpeel monitor <url> --render           - Use browser rendering
 *   webpeel monitor <url> --selector <css>   - Monitor specific section only
 */

import type { Command } from 'commander';
import { createHash } from 'crypto';
import ora from 'ora';
import { peel, cleanup } from '../../index.js';
import { trackChange, getSnapshot } from '../../core/change-tracking.js';
import type { PeelOptions } from '../../types.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Run a single monitor check. Returns exit code (0 = ok, 1 = error). */
async function runMonitorCheck(url: string, options: {
  json: boolean;
  render: boolean;
  selector?: string;
  silent: boolean;
  timeout?: number;
}): Promise<{ exitCode: number; changed: boolean }> {
  const spinner = options.silent || options.json ? null : ora(`Checking ${url}...`).start();

  try {
    const peelOptions: PeelOptions = {
      render: options.render || false,
      selector: options.selector,
      format: 'markdown',
      timeout: options.timeout,
      raw: false,
    };

    const result = await peel(url, peelOptions);
    const content = result.content ?? '';
    const fp = fingerprint(content);

    if (spinner) spinner.succeed(`Fetched in ${result.elapsed ?? 0}ms`);

    const changeResult = await trackChange(url, content, fp);

    if (options.json) {
      const out: Record<string, unknown> = {
        success: true,
        url,
        changeStatus: changeResult.changeStatus,
        previousScrapeAt: changeResult.previousScrapeAt,
        checkedAt: new Date().toISOString(),
      };
      if (changeResult.diff) {
        out.diff = {
          additions: changeResult.diff.additions,
          deletions: changeResult.diff.deletions,
          text: changeResult.diff.text,
        };
      }
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return { exitCode: 0, changed: changeResult.changeStatus === 'changed' };
    }

    // Human-readable output
    switch (changeResult.changeStatus) {
      case 'new': {
        console.log(`📸 Baseline snapshot saved for ${url}`);
        break;
      }
      case 'same': {
        const since = changeResult.previousScrapeAt
          ? formatTimestamp(changeResult.previousScrapeAt)
          : 'last check';
        console.log(`✅ No changes detected since ${since}`);
        break;
      }
      case 'changed': {
        const since = changeResult.previousScrapeAt
          ? formatTimestamp(changeResult.previousScrapeAt)
          : 'last check';
        console.log(`\n🔔 Changes detected since ${since}:`);
        console.log('');

        if (changeResult.diff) {
          const { additions, deletions, text } = changeResult.diff;

          // Print unified diff with color
          if (text) {
            for (const line of text.split('\n')) {
              if (line.startsWith('+')) {
                process.stdout.write(`\x1b[32m${line}\x1b[0m\n`);
              } else if (line.startsWith('-')) {
                process.stdout.write(`\x1b[31m${line}\x1b[0m\n`);
              } else if (line.startsWith('@')) {
                process.stdout.write(`\x1b[36m${line}\x1b[0m\n`);
              } else {
                process.stdout.write(`${line}\n`);
              }
            }
          }

          console.log('');
          console.log(`📊 Summary: \x1b[32m+${additions} lines added\x1b[0m, \x1b[31m-${deletions} lines removed\x1b[0m`);
        }
        break;
      }
    }

    return { exitCode: 0, changed: changeResult.changeStatus === 'changed' };
  } catch (error) {
    if (spinner) spinner.fail('Monitor check failed');

    const msg = error instanceof Error ? error.message : 'Unknown error';

    if (options.json) {
      process.stdout.write(JSON.stringify({ success: false, url, error: msg }) + '\n');
    } else {
      console.error(`\nError: ${msg}`);
    }

    return { exitCode: 1, changed: false };
  }
}

// ─── registerMonitorCommands ──────────────────────────────────────────────────

export function registerMonitorCommands(program: Command): void {
  program
    .command('monitor <url>')
    .description('Monitor a URL for content changes (saves snapshots, shows diffs)')
    .option('-r, --render', 'Use headless browser (for JS-heavy sites)')
    .option('--selector <css>', 'CSS selector — only monitor this section of the page')
    .option('-i, --interval <seconds>', 'Watch mode: re-check every N seconds', parseInt)
    .option('--json', 'Output as JSON (for automation/scripting)')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('-t, --timeout <ms>', 'Request timeout (ms)', (v: string) => parseInt(v, 10), 30000)
    .addHelpText('after', `
Examples:
  webpeel monitor https://example.com/pricing        # First run: save baseline
  webpeel monitor https://example.com/pricing        # Second run: show diff
  webpeel monitor https://example.com/pricing --interval 300   # Watch every 5 min
  webpeel monitor https://example.com/pricing --render         # JS-rendered page
  webpeel monitor https://example.com/pricing --json           # JSON output
  webpeel monitor https://example.com/pricing --selector .price # Monitor prices only
    `)
    .action(async (url: string, options) => {
      // Validate URL
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          console.error('Error: Only HTTP and HTTPS protocols are allowed');
          process.exit(1);
        }
      } catch {
        console.error(`Error: Invalid URL format: ${url}`);
        process.exit(1);
      }

      const checkOptions = {
        json: options.json || false,
        render: options.render || false,
        selector: options.selector as string | undefined,
        silent: options.silent || false,
        timeout: options.timeout as number | undefined,
      };

      const intervalSec = options.interval as number | undefined;

      if (!intervalSec) {
        // Single run
        const { exitCode } = await runMonitorCheck(url, checkOptions);
        await cleanup();
        process.exit(exitCode);
      } else {
        // Watch mode
        if (intervalSec < 5) {
          console.error('Error: --interval must be at least 5 seconds');
          process.exit(1);
        }

        if (!options.json && !options.silent) {
          const prev = await getSnapshot(url);
          const baselineNote = prev
            ? `(baseline exists from ${formatTimestamp(new Date(prev.timestamp).toISOString())})`
            : '(no baseline yet — first run will save it)';
          console.log(`👁  Watching ${url} every ${intervalSec}s ${baselineNote}`);
          console.log('Press Ctrl+C to stop.\n');
        }

        // Initial check immediately
        await runMonitorCheck(url, checkOptions);

        // Then loop
        const loop = setInterval(async () => {
          if (!options.json && !options.silent) {
            console.log(`\n⏰ ${new Date().toLocaleTimeString()} — checking...`);
          }
          await runMonitorCheck(url, checkOptions);
        }, intervalSec * 1000);

        // Graceful shutdown
        process.on('SIGINT', async () => {
          clearInterval(loop);
          if (!options.json && !options.silent) {
            console.log('\n👋 Stopped monitoring.');
          }
          await cleanup();
          process.exit(0);
        });
      }
    });
}
