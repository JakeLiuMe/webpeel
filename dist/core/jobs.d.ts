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
/**
 * Search job boards and return structured results.
 *
 * Uses `peel()` internally so all smart-escalation / stealth logic applies.
 * Call `cleanup()` from the main webpeel export when you're done with all
 * fetching (this module does **not** call it automatically because the
 * browser instance is shared across the library).
 */
export declare function searchJobs(options: JobSearchOptions): Promise<JobSearchResult>;
//# sourceMappingURL=jobs.d.ts.map