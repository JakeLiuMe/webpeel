/**
 * Observe command: structured page observation for AI agents
 *
 * Usage:
 *   webpeel observe <url>                  - List all interactive elements
 *   webpeel observe <url> --json           - JSON output for agents
 *   webpeel observe <url> --screenshot     - Include screenshot
 *   webpeel observe <url> --selector main  - Scope to a section
 *   webpeel observe <url> --viewport mobile - Mobile viewport
 */

import type { Command } from 'commander';
import ora from 'ora';
import { writeFileSync } from 'fs';
import { cleanup } from '../../index.js';
import { writeStdout } from '../utils.js';

export function registerObserveCommand(program: Command): void {
  program
    .command('observe <url>')
    .alias('obs')
    .description('Observe a page — list interactive elements (links, buttons, inputs, forms) for agent use')
    .option('--json', 'Output as JSON (default for piped output)')
    .option('-s, --silent', 'Silent mode (no spinner)')
    .option('--selector <css>', 'CSS selector to scope observation')
    .option('--viewport <v>', 'Viewport: desktop (default), mobile, tablet, or WxH', 'desktop')
    .option('--screenshot', 'Include a screenshot')
    .option('--screenshot-full-page', 'Full-page screenshot')
    .option('--screenshot-output <path>', 'Save screenshot to file instead of base64 in JSON')
    .option('--max-elements <n>', 'Max elements per category (default: 50)', (v: string) => parseInt(v, 10), 50)
    .option('-t, --timeout <ms>', 'Request timeout in ms', (v: string) => parseInt(v, 10), 30000)
    .option('--stealth', 'Stealth mode for bot-protected sites')
    .addHelpText('after', `
Examples:
  webpeel observe https://news.ycombinator.com             # See all interactive elements
  webpeel observe https://github.com --json                # JSON for agent consumption
  webpeel observe https://amazon.com/dp/... --selector main  # Scope to main content
  webpeel observe https://example.com --viewport mobile    # Mobile viewport
  webpeel observe https://example.com --screenshot -o snap.png  # With screenshot
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

      const spinner = options.silent ? null : ora('Observing page...').start();

      try {
        const { observe } = await import('../../core/observe.js');

        // Parse viewport
        let viewport: 'desktop' | 'mobile' | 'tablet' | { width: number; height: number } = 'desktop';
        const vpArg = options.viewport as string;
        if (vpArg === 'mobile' || vpArg === 'tablet') {
          viewport = vpArg;
        } else if (vpArg && vpArg.includes('x')) {
          const [w, h] = vpArg.split('x').map(Number);
          if (w && h) viewport = { width: w, height: h };
        }

        const result = await observe({
          url,
          selector: options.selector,
          viewport,
          screenshot: options.screenshot || false,
          screenshotFullPage: options.screenshotFullPage || false,
          maxElements: options.maxElements,
          timeout: options.timeout,
          stealth: options.stealth || false,
        });

        if (spinner) {
          spinner.succeed(`Observed ${result.totalElements} elements in ${result.elapsed}ms`);
        }

        // Save screenshot to file if requested
        if (result.screenshot && options.screenshotOutput) {
          const buf = Buffer.from(result.screenshot, 'base64');
          writeFileSync(options.screenshotOutput, buf);
          if (!options.silent) {
            console.error(`Screenshot saved to: ${options.screenshotOutput} (${(buf.length / 1024).toFixed(1)} KB)`);
          }
          // Don't include screenshot in JSON output when saved to file
          delete result.screenshot;
        }

        if (options.json) {
          await writeStdout(JSON.stringify(result, null, 2) + '\n');
        } else {
          // Human-readable output
          console.log(`\n🔍 ${result.title}`);
          console.log(`   ${result.url}`);
          console.log(`   Viewport: ${result.viewport.width}×${result.viewport.height} | Page: ${result.scroll.width}×${result.scroll.height}\n`);

          const { elements } = result;

          if (elements.links.length > 0) {
            console.log(`📎 Links (${elements.links.length}):`);
            for (const el of elements.links.slice(0, 15)) {
              const vp = el.inViewport ? '👁' : '  ';
              const href = el.attributes.href ? ` → ${el.attributes.href.slice(0, 60)}` : '';
              console.log(`  ${vp} [${el.ref}] ${el.text || '(no text)'}${href}`);
            }
            if (elements.links.length > 15) {
              console.log(`  ... and ${elements.links.length - 15} more`);
            }
            console.log('');
          }

          if (elements.buttons.length > 0) {
            console.log(`🔘 Buttons (${elements.buttons.length}):`);
            for (const el of elements.buttons) {
              const vp = el.inViewport ? '👁' : '  ';
              console.log(`  ${vp} [${el.ref}] "${el.text || '(no text)'}" — selector: ${el.selector}`);
            }
            console.log('');
          }

          if (elements.inputs.length > 0) {
            console.log(`✏️  Inputs (${elements.inputs.length}):`);
            for (const el of elements.inputs) {
              const vp = el.inViewport ? '👁' : '  ';
              const type = el.attributes.type || 'text';
              const label = el.text || el.attributes.placeholder || el.attributes.name || 'unnamed';
              console.log(`  ${vp} [${el.ref}] ${label} (${type}) — selector: ${el.selector}`);
            }
            console.log('');
          }

          if (elements.selects.length > 0) {
            console.log(`📋 Selects (${elements.selects.length}):`);
            for (const el of elements.selects) {
              const vp = el.inViewport ? '👁' : '  ';
              const opts = el.attributes.options || '';
              console.log(`  ${vp} [${el.ref}] ${el.text || el.attributes.name || 'dropdown'}${opts ? ` [${opts}]` : ''}`);
            }
            console.log('');
          }

          if (elements.forms.length > 0) {
            console.log(`📝 Forms (${elements.forms.length}):`);
            for (const el of elements.forms) {
              const fields = el.attributes.fields || '?';
              const action = el.attributes.action || '';
              console.log(`  [${el.ref}] ${el.text || 'form'} — ${fields} fields${action ? ` → ${action.slice(0, 60)}` : ''}`);
            }
            console.log('');
          }

          console.log(`📊 Summary: ${result.summary}`);
        }

        await cleanup();
        process.exit(0);
      } catch (error) {
        if (spinner) spinner.fail('Observation failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await cleanup();
        process.exit(1);
      }
    });
}
