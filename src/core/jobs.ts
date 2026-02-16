/**
 * Jobs extraction module — turns job board pages into structured JSON
 *
 * Two-phase pipeline:
 *   Phase A (Search): Fetch a job search URL → parse markdown → extract job cards
 *   Phase B (Details): For top N results, fetch each detail URL → extract full description
 *
 * Supports LinkedIn, Glassdoor, and Indeed out of the box.
 * Call `cleanup()` from the main webpeel export when you are done fetching.
 */

import { peel } from '../index.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface JobCard {
  title: string;
  company: string;
  location: string;
  salary?: string;
  remote?: boolean;
  postedAt?: string;
  detailUrl: string;
  snippet?: string;
  skills?: string[];
  rating?: number;
  source: 'glassdoor' | 'indeed' | 'linkedin' | 'generic';
}

export interface JobDetail extends JobCard {
  description: string;
  requirements?: string[];
  responsibilities?: string[];
  benefits?: string[];
  applyUrl?: string;
  employmentType?: string;
  experienceLevel?: string;
}

export interface JobSearchOptions {
  /** Search URL to fetch, OR use keywords+location to build URL */
  url?: string;
  /** Job search keywords (e.g. "software engineer") */
  keywords?: string;
  /** Location (e.g. "New York") */
  location?: string;
  /** Which job board to search. Default: 'linkedin' */
  source?: 'glassdoor' | 'indeed' | 'linkedin';
  /** Max job cards to return from search. Default: 25 */
  limit?: number;
  /** Fetch detail pages for top N jobs. 0 = skip details. Default: 0 */
  fetchDetails?: number;
  /** Timeout per request in ms. Default: 30000 */
  timeout?: number;
}

export interface JobSearchResult {
  jobs: (JobCard | JobDetail)[];
  totalFound: number;
  source: string;
  searchUrl: string;
  detailsFetched: number;
  timeTakenMs: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

type Source = 'glassdoor' | 'indeed' | 'linkedin' | 'generic';

function detectSource(url: string): Source {
  const h = url.toLowerCase();
  if (h.includes('linkedin.com')) return 'linkedin';
  if (h.includes('glassdoor.com')) return 'glassdoor';
  if (h.includes('indeed.com')) return 'indeed';
  return 'generic';
}

function stealthNeeded(src: Source): boolean {
  return src === 'indeed' || src === 'glassdoor';
}

function buildSearchUrl(src: Source, kw: string, loc: string): string {
  switch (src) {
    case 'linkedin':
      return `https://www.linkedin.com/jobs/search/?keywords=${enc(kw)}&location=${enc(loc)}`;
    case 'glassdoor':
      return `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${enc(kw)}&locT=C&locId=1132348&sc.location=${enc(loc)}`;
    case 'indeed':
      return `https://www.indeed.com/jobs?q=${enc(kw)}&l=${enc(loc)}`;
    default:
      throw new Error('Cannot build URL for generic source — provide a url');
  }
}

const enc = encodeURIComponent;

function clean(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function absUrl(href: string, base: string): string {
  try { return new URL(href, base).href; } catch { return href; }
}

function findSalary(text: string): string | undefined {
  const m = text.match(
    /\$[\d,]+(?:\.\d+)?(?:\s*[-–]\s*\$[\d,]+(?:\.\d+)?)?(?:\s*(?:a\s+year|per\s+hour|an\s+hour|\/hr|\/yr|K(?:\s|$)))?/i,
  );
  return m ? m[0].trim() : undefined;
}

function findDate(text: string): string | undefined {
  const m = text.match(/(\d+[dhm])\b/) || text.match(/(\d+\s+(?:day|week|month|hour|minute)s?\s+ago)/i);
  return m ? m[1].trim() : undefined;
}

function hasRemote(text: string): boolean {
  return /\bremote\b/i.test(text);
}

/** Simple concurrency limiter — runs at most `n` tasks in parallel. */
async function pLimited<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const idx = cursor++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, () => worker()));
  return results;
}

function parseTotalFromHeading(content: string): number {
  const m = content.match(/^#\s+([\d,]+)\+?\s+/m);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
}

// ── LinkedIn Parser ────────────────────────────────────────────────────

function parseLinkedIn(content: string, searchUrl: string, limit: number): { jobs: JobCard[]; totalFound: number } {
  const jobs: JobCard[] = [];
  const totalFound = parseTotalFromHeading(content);

  // Each card starts with "- [Title](url)" in the markdown list
  const blocks = content.split(/\n-\s+\[/).slice(1);

  for (const block of blocks) {
    if (jobs.length >= limit) break;

    // Link: we stripped the leading "- [", so block starts with "Title](url)…"
    const lm = block.match(/^([^\]]+)\]\(([^)]+)\)/);
    if (!lm) continue;
    const detailUrl = lm[2];
    if (!detailUrl.includes('linkedin.com/jobs/view/')) continue;

    // Title from ### heading (preferred) or link text
    const hm = block.match(/###\s+(.+)/);
    const title = clean(hm ? hm[1] : lm[1]);
    if (!title) continue;

    // Company from #### [Company](url) or #### Company
    const cm = block.match(/####\s+\[([^\]]+)\]/) || block.match(/####\s+(.+)/);
    const company = cm ? clean(cm[1]) : '';

    // Scan remaining lines for location + date
    // Only look at lines AFTER the #### company heading
    let location = '';
    let postedAt: string | undefined;
    let pastCompany = false;
    for (const raw of block.split('\n')) {
      const l = raw.trim();
      if (!l) continue;
      // Skip everything until we're past the company heading
      if (l.startsWith('####')) { pastCompany = true; continue; }
      if (!pastCompany) continue;
      if (l.startsWith('#') || l.startsWith('[') || l.startsWith('-') || l === 'Actively Hiring' || l === 'Promoted') continue;
      // Skip lines that contain URLs
      if (l.includes('http://') || l.includes('https://')) continue;
      // Date-only line
      const dateCandidate = findDate(l);
      // Location line that may have date appended: "New York, NY 2 weeks ago"
      if (!location && /^[A-Z][a-z]+.*,\s*[A-Z]/.test(l)) {
        // Split off trailing date if present
        const dateInLine = findDate(l);
        if (dateInLine) {
          postedAt = dateInLine;
          location = clean(l.replace(/\d+\s+(?:week|day|month|hour|minute)s?\s+ago/i, '').replace(/\d+[dhm]\s*$/i, ''));
        } else {
          location = clean(l);
        }
        continue;
      }
      if (dateCandidate && l.length < 30) { postedAt = dateCandidate; }
    }

    jobs.push({
      title, company, location,
      salary: findSalary(block),
      remote: hasRemote(block),
      postedAt,
      detailUrl: absUrl(detailUrl, searchUrl),
      source: 'linkedin',
    });
  }

  return { jobs, totalFound: totalFound || jobs.length };
}

// ── Glassdoor Parser ───────────────────────────────────────────────────

function parseGlassdoor(content: string, searchUrl: string, limit: number): { jobs: JobCard[]; totalFound: number } {
  const jobs: JobCard[] = [];
  const totalFound = parseTotalFromHeading(content);

  // Each card is a top-level list item: company, rating, [Title](url), location, salary, snippet, skills, date
  const blocks = content.split(/\n-\s+/).slice(1);

  for (const block of blocks) {
    if (jobs.length >= limit) break;

    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    // Job title link
    const lm = block.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]*glassdoor\.com\/job-listing\/[^)]+)\)/);
    if (!lm) continue;
    const title = clean(lm[1]);
    const detailUrl = lm[2];

    // Company + rating come before the link
    let company = '';
    let rating: number | undefined;
    for (const l of lines) {
      if (l.includes('[') && l.includes('glassdoor.com')) break;
      const rm = l.match(/^(\d\.\d)$/);
      if (rm) { rating = parseFloat(rm[1]); continue; }
      if (!company && l.length > 1 && !/^\d/.test(l)) company = clean(l);
    }

    // Fields after the title link
    let location = '';
    let salary: string | undefined;
    let snippet: string | undefined;
    let skills: string[] | undefined;
    let postedAt: string | undefined;
    let pastLink = false;
    for (const l of lines) {
      if (l.includes(title) || l.includes('glassdoor.com/job-listing/')) { pastLink = true; continue; }
      if (!pastLink) continue;
      const sm = l.match(/\*\*Skills?:\*\*\s*(.+)/i);
      if (sm) { skills = sm[1].split(',').map(s => s.trim()).filter(Boolean); continue; }
      if (/^\d+[dwm]$/.test(l)) { postedAt = l; continue; }
      if (!salary && /\$/.test(l)) { salary = findSalary(l) || clean(l); continue; }
      if (!location && /^[A-Z][a-z]+.*,\s*[A-Z]{2}/.test(l)) { location = clean(l); continue; }
      if (!snippet && l.length > 40 && !l.startsWith('**')) snippet = clean(l);
    }

    jobs.push({
      title, company, location, salary,
      remote: hasRemote(block), postedAt,
      detailUrl: absUrl(detailUrl, searchUrl),
      snippet, skills, rating,
      source: 'glassdoor',
    });
  }

  return { jobs, totalFound: totalFound || jobs.length };
}

// ── Indeed Parser ──────────────────────────────────────────────────────

function parseIndeed(content: string, _searchUrl: string, limit: number): { jobs: JobCard[]; totalFound: number } {
  const jobs: JobCard[] = [];

  // Indeed markdown: job listings as list items with [Title](url), company, location, salary
  // Also try HTML attribute patterns in case raw HTML leaks through
  const htmlJobRe = /id="job_([a-f0-9]+)"[^>]*>.*?<span\s+title="([^"]+)"[^>]*>[^<]*<\/span>/gs;
  const htmlJobs = [...content.matchAll(htmlJobRe)];

  if (htmlJobs.length > 0) {
    // HTML mode — parse HTML attributes directly
    const companyRe = /data-testid="company-name"[^>]*>([^<]+)<\/span>/g;
    const locRe = /data-testid="text-location"[^>]*>([^<]+)<\/div>/g;
    const cm = [...content.matchAll(companyRe)];
    const lm = [...content.matchAll(locRe)];

    for (let i = 0; i < htmlJobs.length && jobs.length < limit; i++) {
      const jk = htmlJobs[i][1];
      const title = clean(htmlJobs[i][2]);
      jobs.push({
        title,
        company: cm[i] ? clean(cm[i][1]) : '',
        location: lm[i] ? clean(lm[i][1]) : '',
        salary: findSalary(content.slice(htmlJobs[i].index || 0, (htmlJobs[i + 1]?.index) || content.length)),
        remote: false,
        detailUrl: `https://www.indeed.com/viewjob?jk=${jk}`,
        source: 'indeed',
      });
    }
  } else {
    // Markdown mode — parse the converted markdown output
    // Indeed search results have title links followed by company, location, salary lines
    const blocks = content.split(/\n-\s+/).slice(1);

    for (const block of blocks) {
      if (jobs.length >= limit) break;

      // Title link: [Job Title](url)
      const lm = block.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]*indeed\.com\/[^)]*(?:viewjob|rc\/clk)[^)]*)\)/);
      if (!lm) continue;
      const title = clean(lm[1]);
      let detailUrl = lm[2];

      // Extract jk parameter from URL for clean detail URL
      const jkMatch = detailUrl.match(/[?&]jk=([a-f0-9]+)/);
      if (jkMatch) detailUrl = `https://www.indeed.com/viewjob?jk=${jkMatch[1]}`;

      // Parse remaining lines for company, location, salary
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      let company = '';
      let location = '';
      let salary: string | undefined;

      for (const l of lines) {
        if (l.includes(title) || l.includes('indeed.com')) continue;
        if (!salary) { const s = findSalary(l); if (s) { salary = s; continue; } }
        // Company is usually the first non-title, non-link, non-salary text
        if (!company && l.length > 2 && !l.startsWith('[') && !l.startsWith('#') && !/^\d/.test(l)) {
          company = clean(l);
          continue;
        }
        // Location matches City, ST pattern
        if (!location && /^[A-Z][a-z]+.*,\s*[A-Z]{2}/.test(l)) {
          location = clean(l);
        }
      }

      if (title) {
        jobs.push({
          title, company, location, salary,
          remote: hasRemote(block),
          detailUrl,
          source: 'indeed',
        });
      }
    }
  }

  const totalRe = content.match(/(?:of|about)\s+([\d,]+)\s+jobs/i) || content.match(/([\d,]+)\s+jobs/i);
  const totalFound = totalRe ? parseInt(totalRe[1].replace(/,/g, ''), 10) : jobs.length;

  return { jobs, totalFound };
}

// ── Generic Detail Parser ──────────────────────────────────────────────

interface ParsedSections {
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  benefits?: string[];
}

// Match both heading markers (## Section) and bold markers (**Section:**)
const SEC_DESC = /(?:#{1,4}\s*|^\*\*)(?:(?:full\s+)?job\s+description|about\s+(?:the\s+)?(?:role|position|job|opportunity)|overview|summary)\*?\*?:?\s*$/im;
const SEC_REQ = /(?:#{1,4}\s*|^\*\*)(?:requirements?|qualifications?|what\s+(?:you(?:'ll)?\s+)?(?:need|bring)|minimum\s+qualifications?|must\s+have|what\s+we(?:'re)?\s+look(?:ing)?\s+for|nice\s+to\s+have)\*?\*?:?\s*$/im;
const SEC_RESP = /(?:#{1,4}\s*|^\*\*)(?:responsibilities|what\s+you(?:'ll)?\s+do|duties|key\s+responsibilities|your\s+role|in\s+this\s+role)\*?\*?:?\s*$/im;
const SEC_BEN = /(?:#{1,4}\s*|^\*\*)(?:benefits?|perks?|what\s+we\s+offer|compensation(?:\s+and\s+benefits)?|why\s+(?:join|work)|our\s+offer)\*?\*?:?\s*$/im;

function extractBullets(text: string): string[] | undefined {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const t = line.replace(/^[-*•]\s+/, '').trim();
    if (t.length > 5) out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

function splitSections(content: string): ParsedSections {
  const res: ParsedSections = {};
  type SecKey = 'desc' | 'req' | 'resp' | 'ben';
  let cur: SecKey | null = null;
  let buf: string[] = [];

  function flush(): void {
    const txt = buf.join('\n').trim();
    buf = [];
    if (!txt || !cur) return;
    if (cur === 'desc') res.description = txt;
    else if (cur === 'req') res.requirements = extractBullets(txt);
    else if (cur === 'resp') res.responsibilities = extractBullets(txt);
    else if (cur === 'ben') res.benefits = extractBullets(txt);
  }

  for (const line of content.split('\n')) {
    if (SEC_DESC.test(line)) { flush(); cur = 'desc'; continue; }
    if (SEC_REQ.test(line)) { flush(); cur = 'req'; continue; }
    if (SEC_RESP.test(line)) { flush(); cur = 'resp'; continue; }
    if (SEC_BEN.test(line)) { flush(); cur = 'ben'; continue; }
    if (cur && /^#{1,4}\s+/.test(line)) { flush(); cur = null; continue; }
    if (cur) buf.push(line);
  }
  flush();

  if (!res.description) res.description = content.slice(0, 2000).trim();
  return res;
}

/** Strip trailing noise sections (similar jobs, people also viewed, etc.) */
function stripDetailNoise(content: string): string {
  const cutPatterns = [
    /^#{1,3}\s*similar\s+jobs/im,
    /^#{1,3}\s*people\s+also\s+viewed/im,
    /^#{1,3}\s*similar\s+searches/im,
    /^#{1,3}\s*explore\s+collaborative/im,
    /^#{1,3}\s*seniority\s+level/im,
    /^#{1,3}\s*company\s+and\s+salary/im,
    /^#{1,3}\s*career\s+guide/im,
    /^#{1,3}\s*jobs\s+with\s+similar/im,
    /^#{1,3}\s*similar\s+jobs?\s+nearby/im,
  ];
  let result = content;
  for (const pattern of cutPatterns) {
    const m = pattern.exec(result);
    if (m && m.index !== undefined && m.index > result.length * 0.3) {
      result = result.slice(0, m.index).trim();
    }
  }
  return result;
}

function parseJobDetail(content: string, card: JobCard): JobDetail {
  // Strip noise sections before parsing
  const cleaned = stripDetailNoise(content);
  const sections = splitSections(cleaned);

  const empMatch = cleaned.match(/\b(full[- ]?time|part[- ]?time|contract|internship|freelance|temporary)\b/i);
  const expMatch = cleaned.match(/\b(entry[- ]?level|mid[- ]?level|senior|lead|principal|staff|junior|intern)\b/i);
  const applyMatch =
    cleaned.match(/\[(?:apply|submit)[^\]]*\]\(([^)]+)\)/i) ||
    cleaned.match(/href="([^"]*(?:apply|submit|careers)[^"]*)"/i);

  // Salary from "## Pay found in job post" or "### Base pay range" sections
  const salary = card.salary || findSalary(cleaned);

  return {
    ...card,
    salary: salary || card.salary,
    description: sections.description || cleaned.slice(0, 3000),
    requirements: sections.requirements,
    responsibilities: sections.responsibilities,
    benefits: sections.benefits,
    applyUrl: applyMatch ? applyMatch[1] : undefined,
    employmentType: empMatch ? empMatch[1].toLowerCase().replace(/\s+/g, '-') : undefined,
    experienceLevel: expMatch ? expMatch[1] : undefined,
  };
}

// ── Main ───────────────────────────────────────────────────────────────

/**
 * Search job boards and return structured results.
 *
 * Uses `peel()` internally so all smart-escalation / stealth logic applies.
 * Call `cleanup()` from the main webpeel export when you're done with all
 * fetching (this module does **not** call it automatically because the
 * browser instance is shared across the library).
 */
export async function searchJobs(options: JobSearchOptions): Promise<JobSearchResult> {
  const startTime = Date.now();

  const {
    url,
    keywords = '',
    location = '',
    source: reqSource = 'linkedin',
    limit = 25,
    fetchDetails = 0,
    timeout = 30000,
  } = options;

  // 1. Determine source & URL
  let searchUrl: string;
  let source: Source;

  if (url) {
    searchUrl = url;
    source = detectSource(url);
  } else {
    if (!keywords) throw new Error('Either url or keywords must be provided');
    source = reqSource;
    searchUrl = buildSearchUrl(source, keywords, location);
  }

  // 2. Fetch search page
  const result = await peel(searchUrl, {
    stealth: stealthNeeded(source),
    timeout,
    format: 'markdown',
  });

  // 3. Parse job cards
  let parsed: { jobs: JobCard[]; totalFound: number };

  switch (source) {
    case 'linkedin':
      parsed = parseLinkedIn(result.content, searchUrl, limit);
      break;
    case 'glassdoor':
      parsed = parseGlassdoor(result.content, searchUrl, limit);
      break;
    case 'indeed':
      parsed = parseIndeed(result.content, searchUrl, limit);
      break;
    default: {
      // Try each parser for unknown URLs
      parsed = parseLinkedIn(result.content, searchUrl, limit);
      if (!parsed.jobs.length) parsed = parseGlassdoor(result.content, searchUrl, limit);
      if (!parsed.jobs.length) parsed = parseIndeed(result.content, searchUrl, limit);
      break;
    }
  }

  // 4. Optionally fetch detail pages (max 3 concurrent)
  let detailsFetched = 0;
  let jobs: (JobCard | JobDetail)[] = parsed.jobs;

  if (fetchDetails > 0 && parsed.jobs.length > 0) {
    const toFetch = parsed.jobs.slice(0, fetchDetails);
    const srcForStealth = source;

    const tasks = toFetch.map((card) => async () => {
      try {
        const dr = await peel(card.detailUrl, {
          stealth: stealthNeeded(srcForStealth),
          timeout,
          format: 'markdown',
        });
        detailsFetched++;
        return parseJobDetail(dr.content, card);
      } catch {
        return card; // graceful fallback
      }
    });

    const detailed = await pLimited(tasks, 3);
    jobs = [...detailed, ...parsed.jobs.slice(fetchDetails)];
  }

  return {
    jobs,
    totalFound: parsed.totalFound,
    source,
    searchUrl,
    detailsFetched,
    timeTakenMs: Date.now() - startTime,
  };
}
