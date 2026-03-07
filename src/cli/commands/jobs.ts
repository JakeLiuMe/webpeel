/**
 * Jobs commands: serve, mcp, jobs, queue, job, apply, profile, hotels
 */

import type { Command } from 'commander';
import ora from 'ora';
import { readFileSync } from 'fs';
import { loadConfig } from '../../cli-auth.js';
import { writeStdout, formatRelativeTime } from '../utils.js';
import { listProfiles, deleteProfile, createProfile, getProfilePath } from '../../core/profiles.js';
import { cleanup } from '../../index.js';

// ─── Shared job-search logic ─────────────────────────────────────────────────

async function runJobSearch(keywords: string, options: {
  location?: string;
  source?: string;
  limit?: string;
  details?: string;
  json?: boolean;
  timeout?: string;
  silent?: boolean;
}): Promise<void> {
  const spinner = options.silent ? null : ora('Searching jobs...').start();

  try {
    const { searchJobs } = await import('../../core/jobs.js');
    type JobDetail = import('../../core/jobs.js').JobDetail;

    const VALID_SOURCES = ['glassdoor', 'indeed', 'linkedin', 'upwork'] as const;
    type ValidSource = typeof VALID_SOURCES[number];
    const source: ValidSource = (VALID_SOURCES.includes((options.source ?? 'linkedin') as ValidSource)
      ? options.source
      : 'linkedin') as ValidSource;
    const limit = Math.min(Math.max(parseInt(options.limit ?? '25', 10) || 25, 1), 100);
    const fetchDetails = Math.min(Math.max(parseInt(options.details ?? '0', 10) || 0, 0), limit);
    const timeout = parseInt(options.timeout ?? '30000', 10) || 30000;

    const result = await searchJobs({
      keywords,
      location: options.location,
      source,
      limit,
      fetchDetails,
      timeout,
    });

    if (spinner) spinner.stop();

    if (options.json) {
      await writeStdout(JSON.stringify(result, null, 2) + '\n');
      process.exit(0);
    }

    const totalLabel = result.totalFound >= 1000
      ? `${(result.totalFound / 1000).toFixed(0).replace(/\.0$/, '')}k+`
      : String(result.totalFound);

    const locationLabel = options.location ? ` in ${options.location}` : '';
    console.log(`\n🔍 Found ${totalLabel} ${keywords} jobs${locationLabel} (${result.source})\n`);

    if (result.jobs.length === 0) {
      console.log('  No jobs found.\n');
      process.exit(0);
    }

    const colNum = 3;
    const colTitle = 40;
    const colCompany = 18;
    const colLocation = 16;
    const colSalary = 14;
    const colPosted = 10;

    const pad = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);
    const rpad = (s: string, w: number) => s.padStart(w);

    console.log(
      ` ${rpad('#', colNum)}  ${pad('Title', colTitle)}  ${pad('Company', colCompany)}  ${pad('Location', colLocation)}  ${pad('Salary/Budget', colSalary)}  ${pad('Posted', colPosted)}`
    );

    result.jobs.forEach((job, i) => {
      const titleStr = job.title + (job.remote ? ' 🏠' : '');
      const salaryStr = job.salary ?? ('budget' in job ? (job as any).budget : '') ?? '';
      console.log(
        ` ${rpad(String(i + 1), colNum)}  ${pad(titleStr, colTitle)}  ${pad(job.company, colCompany)}  ${pad(job.location, colLocation)}  ${pad(salaryStr, colSalary)}  ${pad(job.postedAt ?? '', colPosted)}`
      );
    });

    const timeSec = (result.timeTakenMs / 1000).toFixed(1);
    const detailsNote = fetchDetails > 0 ? ` | Details: ${result.detailsFetched} fetched` : '';
    console.log(`\nFetched ${result.jobs.length} jobs in ${timeSec}s${detailsNote}\n`);

    const detailedJobs = result.jobs.filter((j): j is JobDetail => 'description' in j);
    for (let i = 0; i < detailedJobs.length; i++) {
      const job = detailedJobs[i]!;
      console.log(`━━━ Job #${i + 1}: ${job.title} ━━━`);
      const metaParts = [`Company: ${job.company}`, `Location: ${job.location}`];
      if (job.salary) metaParts.push(`Salary: ${job.salary}`);
      console.log(metaParts.join(' | '));

      const typeParts: string[] = [];
      if (job.employmentType) typeParts.push(`Type: ${job.employmentType}`);
      if (job.experienceLevel) typeParts.push(`Level: ${job.experienceLevel}`);
      if (job.postedAt) typeParts.push(`Posted: ${job.postedAt}`);
      if (typeParts.length > 0) console.log(typeParts.join(' | '));

      if (job.description) {
        console.log(`\nDescription:\n  ${job.description.slice(0, 500).replace(/\n/g, '\n  ')}`);
      }
      if (job.requirements && job.requirements.length > 0) {
        console.log(`\nRequirements:`);
        job.requirements.forEach(r => console.log(`  • ${r}`));
      }
      if (job.responsibilities && job.responsibilities.length > 0) {
        console.log(`\nResponsibilities:`);
        job.responsibilities.forEach(r => console.log(`  • ${r}`));
      }
      if (job.benefits && job.benefits.length > 0) {
        console.log(`\nBenefits:`);
        job.benefits.forEach(b => console.log(`  • ${b}`));
      }
      if (job.applyUrl) {
        console.log(`\nApply: ${job.applyUrl}`);
      }
      console.log('');
    }

    process.exit(0);
  } catch (error) {
    if (spinner) (spinner as any).fail?.('Job search failed');
    console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// ─── registerJobsCommands ────────────────────────────────────────────────────

export function registerJobsCommands(program: Command): void {

  // ── serve command ─────────────────────────────────────────────────────────
  program
    .command('serve')
    .description('Start API server')
    .option('-p, --port <port>', 'Port number', '3000')
    .action(async (options) => {
      const { startServer } = await import('../../server/app.js');
      startServer({ port: parseInt(options.port, 10) });
    });

  // ── mcp command ───────────────────────────────────────────────────────────
  program
    .command('mcp')
    .description('Start MCP server for Claude Desktop / Cursor')
    .action(async () => {
      await import('../../mcp/server.js');
    });

  // ── jobs command group ────────────────────────────────────────────────────
  const jobsCmd = program
    .command('jobs')
    .description('Job board operations: search listings and auto-apply (LinkedIn, Indeed, Glassdoor, Upwork)')
    .argument('[keywords]', 'Search keywords — shorthand for "jobs search <keywords>"')
    .option('-l, --location <location>', 'Location filter')
    .option('-s, --source <source>', 'Job board: glassdoor, indeed, linkedin, or upwork (default: linkedin)', 'linkedin')
    .option('-n, --limit <number>', 'Max results (default: 25)', '25')
    .option('-d, --details <number>', 'Fetch full details for top N results (default: 0)', '0')
    .option('--json', 'Output raw JSON')
    .option('--timeout <ms>', 'Request timeout in ms (default: 30000)', '30000')
    .option('--silent', 'Silent mode (no spinner)')
    .action(async (keywords: string | undefined, options) => {
      // Default action: when called as `webpeel jobs <keywords>`, act as search
      if (!keywords) {
        jobsCmd.help();
        process.exit(0);
      }
      // Delegate to shared search logic
      await runJobSearch(keywords, options);
    });

  // jobs search <keywords>  — explicit subcommand (same logic as default action)
  jobsCmd
    .command('search <keywords>')
    .description('Search job boards for listings (LinkedIn, Indeed, Glassdoor, Upwork)')
    .alias('s')
    .option('-l, --location <location>', 'Location filter')
    .option('-s, --source <source>', 'Job board: glassdoor, indeed, linkedin, or upwork (default: linkedin)', 'linkedin')
    .option('-n, --limit <number>', 'Max results (default: 25)', '25')
    .option('-d, --details <number>', 'Fetch full details for top N results (default: 0)', '0')
    .option('--json', 'Output raw JSON')
    .option('--timeout <ms>', 'Request timeout in ms (default: 30000)', '30000')
    .option('--silent', 'Silent mode (no spinner)')
    .action(async (keywords: string, options) => {
      await runJobSearch(keywords, options);
    });

  // jobs apply <url>  — stealth automated job application
  jobsCmd
    .command('apply <url>')
    .description('Stealth automated job application using human behavior simulation')
    .option('--profile <path>', 'Path to profile JSON file', `${process.env.HOME ?? '~'}/.webpeel/profile.json`)
    .option('--resume <path>', 'Path to resume PDF (overrides profile.resumePath)')
    .option('--mode <mode>', 'Submission mode: auto | review | dry-run (default: review)', 'review')
    .option('--session-dir <path>', 'Browser session directory (preserves login cookies)')
    .option('--llm-key <key>', 'LLM API key for custom question answers')
    .option('--llm-provider <name>', 'LLM provider: openai | anthropic (default: openai)', 'openai')
    .option('--daily-limit <n>', 'Max applications per day (default: 8)', '8')
    .option('--no-warmup', 'Skip browsing warmup phase')
    .option('--json', 'Output result as JSON')
    .option('--silent', 'Minimal output')
    .action(async (url: string, options) => {
      const isSilent = options.silent as boolean;
      const isJson = options.json as boolean;
      const mode = (['auto', 'review', 'dry-run'].includes(options.mode as string)
        ? options.mode
        : 'review') as 'auto' | 'review' | 'dry-run';

      if (!isSilent) {
        console.log(`\n🤖 WebPeel Auto-Apply — mode: ${mode}`);
        console.log(`   URL: ${url}\n`);
      }

      // Load profile
      const profilePath = options.profile as string;
      let profile: import('../../core/apply.js').ApplyProfile;
      try {
        const raw = readFileSync(profilePath, 'utf-8');
        profile = JSON.parse(raw) as import('../../core/apply.js').ApplyProfile;
      } catch {
        console.error(`Error: Could not load profile from ${profilePath}`);
        console.error(`Run "webpeel jobs apply-setup" to create a profile.`);
        process.exit(1);
      }

      if (options.resume) {
        profile.resumePath = options.resume as string;
      }

      const spinner = isSilent ? null : ora('Applying...').start();

      try {
        const { applyToJob } = await import('../../core/apply.js');

        const result = await applyToJob({
          url,
          profile,
          mode,
          sessionDir: options.sessionDir as string | undefined,
          llmKey: options.llmKey as string | undefined,
          llmProvider: options.llmProvider as string,
          dailyLimit: parseInt(options.dailyLimit as string, 10) || 8,
          warmup: options.warmup !== false,
          onProgress: isSilent
            ? undefined
            : (event) => {
                if (spinner) spinner.text = `[${event.stage}] ${event.message}`;
                else console.log(`  [${event.stage}] ${event.message}`);
              },
        });

        if (spinner) spinner.stop();

        if (isJson) {
          await writeStdout(JSON.stringify(result, null, 2) + '\n');
          process.exit(result.error ? 1 : 0);
        }

        const statusIcon = result.submitted ? '✅' : result.error ? '❌' : '📋';
        console.log(
          `\n${statusIcon} ${
            result.submitted
              ? 'Application submitted!'
              : result.error
                ? `Error: ${result.error}`
                : 'Application completed (not submitted)'
          }`
        );
        if (result.job.title || result.job.company) {
          console.log(`   ${result.job.title}${result.job.company ? ` @ ${result.job.company}` : ''}`);
        }
        console.log(`\n   Fields filled: ${result.fieldsFilled}`);
        if (result.llmAnswers > 0) console.log(`   LLM answers: ${result.llmAnswers}`);
        if (result.fieldsSkipped.length > 0) console.log(`   Skipped: ${result.fieldsSkipped.join(', ')}`);
        if (result.warnings.length > 0 && !isSilent) {
          console.log(`\n   Warnings:`);
          result.warnings.forEach(w => console.log(`   ⚠️  ${w}`));
        }
        console.log(`   Time: ${(result.elapsed / 1000).toFixed(1)}s\n`);

        process.exit(result.error ? 1 : 0);
      } catch (error) {
        if (spinner) spinner.fail('Application failed');
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // jobs apply-setup  — interactive wizard to create ~/.webpeel/profile.json
  jobsCmd
    .command('apply-setup')
    .description('Interactive setup wizard — creates ~/.webpeel/profile.json')
    .action(async () => {
      const { createInterface } = await import('readline');

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise(resolve => rl.question(q, ans => resolve(ans.trim())));

      console.log('\n🤖 WebPeel Apply Setup — Create your applicant profile\n');
      console.log('This creates ~/.webpeel/profile.json used by "webpeel jobs apply".\n');

      try {
        const name = await ask('Full name: ');
        const email = await ask('Email address: ');
        const phone = await ask('Phone number: ');
        const linkedin = await ask('LinkedIn URL (optional, press Enter to skip): ');
        const website = await ask('Portfolio/website URL (optional): ');
        const location = await ask('City, State (e.g. San Francisco, CA): ');
        const workAuth = await ask(
          'Work authorization (e.g. US Citizen, Permanent Resident, H-1B, Need Sponsorship): '
        );
        const yearsExp = await ask('Years of experience: ');
        const currentTitle = await ask('Current/most recent job title: ');
        const skills = await ask('Skills (comma-separated, e.g. TypeScript, React, Node.js): ');
        const education = await ask('Education (e.g. B.S. Computer Science, MIT): ');
        const resumePath = await ask('Path to resume PDF (e.g. /Users/you/resume.pdf): ');
        const summary = await ask('Professional summary (1-3 sentences): ');
        const salaryMin = await ask('Minimum desired salary (optional, e.g. 120000): ');
        const salaryMax = await ask('Maximum desired salary (optional, e.g. 180000): ');
        const relocate = await ask('Willing to relocate? (y/n): ');
        const sponsorship = await ask('Need visa sponsorship? (y/n): ');

        rl.close();

        const profileData: import('../../core/apply.js').ApplyProfile = {
          name,
          email,
          phone,
          ...(linkedin ? { linkedin } : {}),
          ...(website ? { website } : {}),
          location,
          workAuthorization: workAuth,
          yearsExperience: parseInt(yearsExp, 10) || 0,
          currentTitle,
          skills: skills.split(',').map(s => s.trim()).filter(Boolean),
          education,
          resumePath,
          summary,
          ...(salaryMin && salaryMax
            ? { salaryRange: { min: parseInt(salaryMin, 10), max: parseInt(salaryMax, 10) } }
            : {}),
          willingToRelocate: relocate.toLowerCase().startsWith('y'),
          needsSponsorship: sponsorship.toLowerCase().startsWith('y'),
        };

        const { mkdirSync: mk, writeFileSync: wf, existsSync: ex } = await import('fs');
        const { join: j } = await import('path');
        const { homedir: hd } = await import('os');

        const webpeelDir = j(hd(), '.webpeel');
        if (!ex(webpeelDir)) mk(webpeelDir, { recursive: true });
        const applyProfilePath = j(webpeelDir, 'profile.json');
        wf(applyProfilePath, JSON.stringify(profileData, null, 2), 'utf-8');

        console.log(`\n✅ Profile saved to: ${applyProfilePath}`);
        console.log('\nNext steps:');
        console.log('  1. Apply to a job: webpeel jobs apply https://linkedin.com/jobs/view/...');
        console.log(
          '     (First run opens a browser — log in to LinkedIn, then the session is saved)\n'
        );
      } catch (error) {
        rl.close();
        console.error(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // jobs apply-history  — view application history
  jobsCmd
    .command('apply-history')
    .description('View application history from ~/.webpeel/applications.json')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Number of recent applications to show (default: 20)', '20')
    .action(async (options) => {
      const isJson = options.json as boolean;
      const limit = parseInt(options.limit as string, 10) || 20;

      try {
        const { loadApplications } = await import('../../core/apply.js');
        const allApps = loadApplications();
        const apps = allApps.slice().reverse().slice(0, limit);

        if (isJson) {
          await writeStdout(JSON.stringify(apps, null, 2) + '\n');
          process.exit(0);
        }

        if (apps.length === 0) {
          console.log('\nNo applications yet. Use "webpeel jobs apply <url>" to start.\n');
          process.exit(0);
        }

        console.log(`\n📋 Application History (${apps.length} of ${allApps.length} total)\n`);

        const colDate = 22;
        const colStatus = 10;
        const colTitle = 35;
        const colCompany = 20;
        const colMode = 8;
        const pad = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));

        console.log(
          ` ${pad('Applied', colDate)}  ${pad('Status', colStatus)}  ${pad('Title', colTitle)}  ${pad('Company', colCompany)}  ${pad('Mode', colMode)}`
        );
        console.log(
          ` ${'-'.repeat(colDate)}  ${'-'.repeat(colStatus)}  ${'-'.repeat(colTitle)}  ${'-'.repeat(colCompany)}  ${'-'.repeat(colMode)}`
        );

        for (const app of apps) {
          const date = new Date(app.appliedAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const statusEmoji =
            { applied: '📤', interview: '🎯', offer: '🎉', rejected: '❌', withdrawn: '🚫' }[
              app.status
            ] ?? '';

          console.log(
            ` ${pad(date, colDate)}  ${pad(`${statusEmoji} ${app.status}`, colStatus)}  ${pad(app.title, colTitle)}  ${pad(app.company, colCompany)}  ${pad(app.mode, colMode)}`
          );
        }

        const today = new Date().toISOString().slice(0, 10);
        const todayCount = allApps.filter(a => a.appliedAt.startsWith(today)).length;
        console.log(`\n  Today: ${todayCount} application(s)\n`);

        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // ── queue command ─────────────────────────────────────────────────────────
  program
    .command('queue')
    .description('List active async jobs (crawl, batch)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const config = loadConfig();

        if (!config.apiKey) {
          console.error('Error: API key required. Run `webpeel login` first.');
          process.exit(1);
        }

        const { fetch: undiciFetch } = await import('undici');

        const response = await undiciFetch(`${process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev'}/v1/jobs`, {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
          },
        });

        if (!response.ok) {
          throw new Error(`API error: HTTP ${response.status}`);
        }

        const data = await response.json() as any;
        const jobs = data.jobs || data;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          if (!Array.isArray(jobs) || jobs.length === 0) {
            console.log('No active jobs.');
          } else {
            console.log(`Active Jobs (${jobs.length}):\n`);
            for (const job of jobs) {
              console.log(`ID: ${job.id}`);
              console.log(`Type: ${job.type}`);
              console.log(`Status: ${job.status}`);
              console.log(`URL: ${job.url}`);
              console.log(`Created: ${job.createdAt}`);
              console.log('---');
            }
          }
        }

        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // ── job command ───────────────────────────────────────────────────────────
  program
    .command('job <id>')
    .description('Get status of a specific job')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      try {
        const config = loadConfig();

        if (!config.apiKey) {
          console.error('Error: API key required. Run `webpeel login` first.');
          process.exit(1);
        }

        const { fetch: undiciFetch } = await import('undici');

        const response = await undiciFetch(`${process.env.WEBPEEL_API_URL || 'https://api.webpeel.dev'}/v1/jobs/${id}`, {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
          },
        });

        if (!response.ok) {
          throw new Error(`API error: HTTP ${response.status}`);
        }

        const job = await response.json() as any;

        if (options.json) {
          console.log(JSON.stringify(job, null, 2));
        } else {
          console.log(`Job ID: ${job.id}`);
          console.log(`Type: ${job.type}`);
          console.log(`Status: ${job.status}`);
          console.log(`URL: ${job.url}`);
          console.log(`Created: ${job.createdAt}`);

          if (job.completedAt) {
            console.log(`Completed: ${job.completedAt}`);
          }

          if (job.error) {
            console.log(`Error: ${job.error}`);
          }

          if (job.results) {
            console.log(`\nResults: ${job.results.length} items`);
            if (job.type === 'crawl' && job.results.length > 0) {
              console.log('\nFirst 5 URLs:');
              for (const result of job.results.slice(0, 5)) {
                console.log(`  - ${result.url}`);
              }
            }
          }
        }

        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // ── apply command group ───────────────────────────────────────────────────
  const applyCmd = program
    .command('apply')
    .description('Auto-apply pipeline: submit applications, track history, manage rate limits');

  // apply submit <url>  — auto-apply to a job posting
  applyCmd
    .command('submit <url>')
    .description('Auto-apply to a job posting')
    .alias('s')
    .option('--profile-path <path>', 'Path to apply profile JSON', `${process.env.HOME ?? '~'}/.webpeel/profile.json`)
    .option('--browser-profile <path>', 'Path to persistent browser data dir', `${process.env.HOME ?? '~'}/.webpeel/browser-profile`)
    .option('--headed', 'Run browser visibly (default for apply)')
    .option('--headless', 'Run browser invisibly')
    .option('--confirm', 'Pause for confirmation before submit (default: true)')
    .option('--no-confirm', 'Skip confirmation, auto-submit')
    .option('--dry-run', 'Go through flow but do not submit')
    .option('--generate-cover', 'Generate tailored cover letter (needs OPENAI_API_KEY)')
    .option('--timeout <ms>', 'Timeout in ms (default: 300000)', '300000')
    .option('--json', 'Output result as JSON')
    .option('--silent', 'Silent mode')
    .action(async (url: string, options) => {
      const isSilent = options.silent as boolean;
      const isJson = options.json as boolean;

      // Load profile
      const profilePath = options.profilePath as string;
      let profile: import('../../core/apply.js').ApplyProfile;
      try {
        const raw = readFileSync(profilePath, 'utf-8');
        profile = JSON.parse(raw) as import('../../core/apply.js').ApplyProfile;
      } catch {
        const msg = `Could not load profile from ${profilePath}. Run "webpeel apply init" to create one.`;
        if (isJson) {
          await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const spinner = isSilent ? null : ora('Applying...').start();

      try {
        const { applyToJob } = await import('../../core/apply.js');

        const result = await applyToJob({
          url,
          profile,
          // Use sessionDir for persistent session storage (renamed from browserProfile)
          sessionDir: options.browserProfile as string | undefined,
          // Map dryRun flag → mode: 'dry-run'
          mode: (options.dryRun ? 'dry-run' : (options.noConfirm ? 'auto' : 'review')) as 'auto' | 'review' | 'dry-run',
          timeout: parseInt(options.timeout as string, 10) || 300_000,
        });

        if (spinner) spinner.stop();

        // Normalize result to a consistent output shape
        const success = result.submitted && !result.error;
        const jobTitle = result.job?.title ?? '';
        const jobCompany = result.job?.company ?? '';

        if (isJson) {
          await writeStdout(JSON.stringify(result, null, 2) + '\n');
          process.exit(success ? 0 : 1);
        }

        const icon = success ? '✅' : '❌';
        console.log(`\n${icon} ${success ? 'Application submitted!' : `Failed: ${result.error ?? 'Unknown error'}`}`);
        if (jobTitle) console.log(`   ${jobTitle}${jobCompany ? ` @ ${jobCompany}` : ''}`);
        if (options.dryRun) console.log('   (Dry run — not submitted)');
        console.log(`   Time: ${(result.elapsed / 1000).toFixed(1)}s\n`);

        process.exit(success ? 0 : 1);
      } catch (error) {
        if (spinner) spinner.fail('Application failed');
        const msg = error instanceof Error ? error.message : 'Unknown error';
        if (isJson) {
          await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }
    });

  // apply init  — interactive profile setup
  applyCmd
    .command('init')
    .description('Interactive profile setup — creates ~/.webpeel/profile.json')
    .action(async () => {
      const { createInterface } = await import('readline');

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

      console.log('\n🤖 WebPeel Apply Setup — Create your applicant profile\n');
      console.log('This creates ~/.webpeel/profile.json used by "webpeel apply submit".\n');

      try {
        const name = await ask('Full name: ');
        const email = await ask('Email address: ');
        const phone = await ask('Phone number (optional): ');
        const resumePath = await ask('Path to resume PDF (e.g. /Users/you/resume.pdf): ');
        const currentTitle = await ask('Current/most recent job title: ');
        const yearsExp = await ask('Years of experience: ');
        const skills = await ask('Skills (comma-separated, e.g. TypeScript, React, Node.js): ');
        const education = await ask('Education (e.g. B.S. Computer Science, MIT): ');
        const location = await ask('City, State (e.g. San Francisco, CA): ');
        const workAuth = await ask('Work authorization (e.g. US Citizen, Permanent Resident, H-1B, Need Sponsorship): ');
        const linkedinUrl = await ask('LinkedIn URL (optional): ');
        const websiteUrl = await ask('Portfolio/website URL (optional): ');
        const desiredSalary = await ask('Desired salary (optional, e.g. $150,000): ');

        rl.close();

        const { mkdirSync: mk, writeFileSync: wf } = await import('fs');
        const { join: j } = await import('path');
        const { homedir: hd } = await import('os');

        const webpeelDir = j(hd(), '.webpeel');
        mk(webpeelDir, { recursive: true });

        const applyInitProfile = {
          name,
          email,
          ...(phone ? { phone } : {}),
          resumePath,
          currentTitle,
          yearsExperience: parseInt(yearsExp, 10) || 0,
          skills: skills.split(',').map((s: string) => s.trim()).filter(Boolean),
          education,
          location,
          workAuthorization: workAuth,
          ...(linkedinUrl ? { linkedinUrl } : {}),
          ...(websiteUrl ? { websiteUrl } : {}),
          ...(desiredSalary ? { desiredSalary } : {}),
        };

        const initProfilePath = j(webpeelDir, 'profile.json');
        wf(initProfilePath, JSON.stringify(applyInitProfile, null, 2), 'utf-8');

        console.log(`\n✅ Profile saved to: ${initProfilePath}`);
        console.log('\nNext steps:');
        console.log('  • Apply to a job:  webpeel apply submit <url>');
        console.log('  • Dry run first:   webpeel apply submit <url> --dry-run');
        console.log('  • View stats:      webpeel apply status\n');
      } catch (error) {
        rl.close();
        console.error(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // apply status  — application stats summary
  applyCmd
    .command('status')
    .description('Show application stats')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const { ApplicationTracker } = await import('../../core/application-tracker.js');
        const tracker = new ApplicationTracker();
        const stats = tracker.stats();

        if (options.json) {
          await writeStdout(JSON.stringify(stats, null, 2) + '\n');
          process.exit(0);
        }

        console.log('\n📊 Application Stats\n');
        console.log(`  Total:     ${stats.total}`);
        console.log(`  Today:     ${stats.today}`);
        console.log(`  This week: ${stats.thisWeek}`);

        if (Object.keys(stats.byPlatform).length > 0) {
          console.log('\n  By Platform:');
          for (const [platform, count] of Object.entries(stats.byPlatform)) {
            console.log(`    ${platform.padEnd(12)} ${count}`);
          }
        }

        if (Object.keys(stats.byStatus).length > 0) {
          console.log('\n  By Status:');
          for (const [status, count] of Object.entries(stats.byStatus)) {
            console.log(`    ${status.padEnd(12)} ${count}`);
          }
        }

        console.log('');
        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // apply list  — list applications with optional filters
  applyCmd
    .command('list')
    .description('List tracked applications')
    .option('--platform <platform>', 'Filter by platform (e.g. linkedin, upwork)')
    .option('--status <status>', 'Filter by status (applied, interview, rejected, offer, ...)')
    .option('--since <date>', 'Filter to applications on or after this date (YYYY-MM-DD)')
    .option('--json', 'Output as JSON')
    .option('--limit <n>', 'Max records to show (default: 50)', '50')
    .action(async (options) => {
      try {
        const { ApplicationTracker } = await import('../../core/application-tracker.js');
        const tracker = new ApplicationTracker();
        const limit = parseInt(options.limit as string, 10) || 50;
        const records = tracker.list({
          platform: options.platform as string | undefined,
          status: options.status as string | undefined,
          since: options.since as string | undefined,
        }).slice(0, limit);

        if (options.json) {
          await writeStdout(JSON.stringify(records, null, 2) + '\n');
          process.exit(0);
        }

        if (records.length === 0) {
          console.log('\nNo applications found.\n');
          process.exit(0);
        }

        console.log(`\n📋 Applications (${records.length})\n`);

        const colDate = 12;
        const colStatus = 10;
        const colTitle = 35;
        const colCompany = 20;
        const pad = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);

        console.log(` ${'Date'.padEnd(colDate)}  ${'Status'.padEnd(colStatus)}  ${'Title'.padEnd(colTitle)}  ${'Company'.padEnd(colCompany)}`);
        console.log(` ${'-'.repeat(colDate)}  ${'-'.repeat(colStatus)}  ${'-'.repeat(colTitle)}  ${'-'.repeat(colCompany)}`);

        for (const r of records) {
          const dateStr = r.appliedAt.slice(0, 10);
          console.log(` ${pad(dateStr, colDate)}  ${pad(r.status, colStatus)}  ${pad(r.title, colTitle)}  ${pad(r.company, colCompany)}`);
        }

        console.log('');
        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // apply rate  — rate governor status
  applyCmd
    .command('rate')
    .description('Show rate governor status (daily limits, cooldown, next allowed time)')
    .option('--json', 'Output as JSON')
    .option('--reset-cooldown', 'Clear any active cooldown (manual override)')
    .action(async (options) => {
      try {
        const { RateGovernor, formatDuration } = await import('../../core/rate-governor.js');
        const governor = new RateGovernor();

        if (options.resetCooldown) {
          governor.resetCooldown();
          console.log('✅ Cooldown cleared.');
          process.exit(0);
        }

        const state = governor.getState();
        const config = governor.getConfig();
        const check = governor.canApply();

        if (options.json) {
          await writeStdout(JSON.stringify({
            state,
            config,
            canApply: check.allowed,
            reason: check.reason,
            waitMs: check.waitMs,
            nextDelayMs: governor.getNextDelay(),
          }, null, 2) + '\n');
          process.exit(0);
        }

        console.log('\n⏱  Rate Governor Status\n');
        console.log(`  Today's applications: ${state.todayCount} / ${config.maxPerDay}`);
        console.log(`  Total applications:   ${state.totalApplications}`);
        console.log(`  Can apply now:        ${check.allowed ? '✅ Yes' : '❌ No'}`);
        if (!check.allowed && check.reason) {
          console.log(`  Reason:               ${check.reason}`);
        }
        if (!check.allowed && check.waitMs) {
          console.log(`  Wait time:            ${formatDuration(check.waitMs)}`);
        }
        if (state.cooldownUntil > 0) {
          const remaining = state.cooldownUntil - Date.now();
          console.log(`  Cooldown:             Active (${formatDuration(Math.max(0, remaining))} remaining)`);
        }
        console.log(`  Min delay:            ${formatDuration(config.minDelayMs)}`);
        console.log(`  Max delay:            ${formatDuration(config.maxDelayMs)}`);
        console.log(`  Active hours:         ${config.activeHours[0]}:00 – ${config.activeHours[1]}:00`);
        console.log(`  Weekdays only:        ${config.weekdaysOnly ? 'Yes' : 'No'}`);
        console.log('');

        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
      }
    });

  // ── profile command group ─────────────────────────────────────────────────
  const profileCmd = program
    .command('profile')
    .description('Manage named browser profiles (saved login sessions)');

  profileCmd
    .command('create <name>')
    .description('Create a new profile interactively (launches browser, log in, press Ctrl+C when done)')
    .option('--description <text>', 'Optional description for this profile')
    .action(async (name: string, opts) => {
      try {
        await createProfile(name, opts.description);
        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  profileCmd
    .command('list')
    .description('List all saved browser profiles')
    .action(() => {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        console.log('No profiles found.');
        console.log('');
        console.log('Create one with:');
        console.log('  webpeel profile create <name>');
        console.log('');
        console.log('Then use it with:');
        console.log('  webpeel <url> --profile <name>');
        process.exit(0);
      }

      console.log('');
      console.log('Saved profiles:');
      console.log('');

      // Column widths
      const nameW = Math.max(8, ...profiles.map((p) => p.name.length));
      const domainsW = Math.max(10, ...profiles.map((p) => (p.domains.join(', ') || '(none)').length));

      const header =
        'Name'.padEnd(nameW) + '  ' +
        'Domains'.padEnd(domainsW) + '  ' +
        'Last Used'.padEnd(12) + '  ' +
        'Created';
      console.log(header);
      console.log('─'.repeat(header.length + 4));

      for (const p of profiles) {
        const domainsStr = p.domains.length > 0 ? p.domains.join(', ') : '(none)';
        const lastUsed = formatRelativeTime(new Date(p.lastUsed));
        const created = new Date(p.created).toISOString().split('T')[0];
        console.log(
          p.name.padEnd(nameW) + '  ' +
          domainsStr.padEnd(domainsW) + '  ' +
          lastUsed.padEnd(12) + '  ' +
          created,
        );
      }
      console.log('');
      process.exit(0);
    });

  profileCmd
    .command('show <name>')
    .description('Show details for a profile')
    .action((name: string) => {
      const profilePath = getProfilePath(name);
      if (!profilePath) {
        console.error(`Error: Profile "${name}" not found.`);
        console.error('Run "webpeel profile list" to see available profiles.');
        process.exit(1);
      }

      try {
        const meta = JSON.parse(readFileSync(`${profilePath}/metadata.json`, 'utf-8'));
        console.log('');
        console.log(`Profile: ${meta.name}`);
        if (meta.description) console.log(`Description: ${meta.description}`);
        console.log(`Created:     ${new Date(meta.created).toLocaleString()}`);
        console.log(`Last used:   ${new Date(meta.lastUsed).toLocaleString()}`);
        console.log(`Domains:     ${meta.domains.length > 0 ? meta.domains.join(', ') : '(none)'}`);
        console.log(`Directory:   ${profilePath}`);
        console.log('');
        process.exit(0);
      } catch (e) {
        console.error(`Error reading profile: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  profileCmd
    .command('delete <name>')
    .description('Delete a saved profile')
    .action((name: string) => {
      const deleted = deleteProfile(name);
      if (deleted) {
        console.log(`Profile "${name}" deleted.`);
        process.exit(0);
      } else {
        console.error(`Error: Profile "${name}" not found.`);
        console.error('Run "webpeel profile list" to see available profiles.');
        process.exit(1);
      }
    });

  // ── hotels command ────────────────────────────────────────────────────────
  program
    .command('hotels <destination>')
    .description('Search multiple travel sites for hotels (Kayak, Booking.com, Google Travel)')
    .option('--checkin <date>', 'Check-in date (ISO or relative, e.g. "tomorrow", "2026-02-20"). Default: tomorrow')
    .option('--checkout <date>', 'Check-out date (ISO or relative). Default: checkin + 1 day')
    .option('--sort <method>', 'Sort by: price, rating, value (default: price)', 'price')
    .option('--limit <n>', 'Max results (default: 20)', '20')
    .option('--source <name...>', 'Only use specific source(s): kayak, booking, google (repeatable)')
    .option('--json', 'Output as JSON')
    .option('--stealth', 'Use stealth mode for all sources')
    .option('--proxy <url>', 'Proxy URL for requests (http://host:port, socks5://user:pass@host:port)')
    .option('-s, --silent', 'Suppress progress messages')
    .action(async (destination: string, options) => {
      const isJson = options.json as boolean;
      const isSilent = options.silent as boolean;

      // Build checkin/checkout
      const { parseDate, addDays: hotelAddDays } = await import('../../core/hotel-search.js');
      let checkinStr: string;
      let checkoutStr: string;
      try {
        checkinStr = parseDate(options.checkin ?? 'tomorrow');
        checkoutStr = options.checkout
          ? parseDate(options.checkout)
          : hotelAddDays(checkinStr, 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isJson) {
          await writeStdout(JSON.stringify({ success: false, error: { type: 'invalid_request', message: msg } }) + '\n');
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const sortMethod = (['price', 'rating', 'value'].includes(options.sort as string)
        ? options.sort
        : 'price') as 'price' | 'rating' | 'value';

      const limit = Math.max(1, parseInt(options.limit as string, 10) || 20);

      const sources: string[] | undefined = options.source
        ? (Array.isArray(options.source) ? options.source : [options.source]) as string[]
        : undefined;

      // Spinner per-source progress (non-silent, non-JSON)
      let searchSpinner: import('ora').Ora | null = null;
      if (!isSilent && !isJson) {
        searchSpinner = ora(`Searching hotels in ${destination}...`).start();
      } else if (!isSilent && !isJson) {
        console.error(`⏳ Searching kayak.com...`);
        console.error(`⏳ Searching booking.com...`);
        console.error(`⏳ Searching google.com...`);
      }

      try {
        const { searchHotels } = await import('../../core/hotel-search.js');

        const result = await searchHotels({
          destination,
          checkin: checkinStr!,
          checkout: checkoutStr!,
          sort: sortMethod,
          limit,
          sources,
          stealth: options.stealth as boolean | undefined,
          silent: isSilent,
          proxy: options.proxy as string | undefined,
        });

        if (searchSpinner) searchSpinner.stop();

        // Show per-source status
        if (!isSilent && !isJson) {
          for (const src of result.sources) {
            if (src.status === 'ok') {
              console.error(`✅ ${src.name}: ${src.count} hotels found`);
            } else {
              console.error(`❌ ${src.name}: ${src.status}${src.error ? ' — ' + src.error : ''}`);
            }
          }
        }

        if (isJson) {
          await writeStdout(JSON.stringify(result, null, 2) + '\n');
          await cleanup();
          process.exit(0);
        }

        // Human-readable table output
        const { formatDate: fmtDate } = {
          formatDate: (iso: string): string => {
            const d = new Date(iso + 'T12:00:00Z');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
          },
        };

        const ci = fmtDate(result.checkin);
        const co = fmtDate(result.checkout);

        console.log(`\n🏨 Hotels in ${result.destination}`);
        console.log(`   ${ci} → ${co} | Sorted by ${sortMethod}\n`);

        if (result.results.length === 0) {
          console.log('   No hotels found.\n');
        } else {
          const colNum = 3;
          const colName = 42;
          const colPrice = 8;
          const colRating = 8;
          const colSource = 10;
          const padEnd = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);
          const padStart = (s: string, w: number) => s.padStart(w);

          console.log(
            ` ${padStart('#', colNum)}  ${padEnd('Hotel', colName)}  ${padEnd('Price', colPrice)}  ${padEnd('Rating', colRating)}  ${padEnd('Source', colSource)}`
          );

          result.results.forEach((hotel, i) => {
            const priceStr = hotel.priceDisplay || '—';
            const ratingStr = hotel.rating !== null ? String(hotel.rating) : '—';
            console.log(
              ` ${padStart(String(i + 1), colNum)}  ${padEnd(hotel.name, colName)}  ${padEnd(priceStr, colPrice)}  ${padEnd(ratingStr, colRating)}  ${padEnd(hotel.source, colSource)}`
            );
          });

          console.log('');
          const sourceSummary = result.sources
            .map(s => `${s.name} (${s.count} ${s.status === 'ok' ? '✅' : s.status === 'blocked' ? '🚫' : '❌'})`)
            .join(' | ');
          console.log(`Sources: ${sourceSummary}`);
        }

        console.log('');
        await cleanup();
        process.exit(0);
      } catch (error) {
        if (searchSpinner) searchSpinner.fail('Hotel search failed');
        const msg = error instanceof Error ? error.message : 'Unknown error';
        if (isJson) {
          await writeStdout(JSON.stringify({ success: false, error: { type: 'fetch_failed', message: msg } }) + '\n');
        } else {
          console.error(`\nError: ${msg}`);
        }
        await cleanup();
        process.exit(1);
      }
    });
}
