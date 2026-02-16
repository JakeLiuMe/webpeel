/**
 * Async jobs API - crawl endpoints with SSE support
 */
import { Router } from 'express';
import type { AuthStore } from '../auth-store.js';
import type { IJobQueue } from '../job-queue.js';
export declare function createJobsRouter(jobQueue: IJobQueue, authStore: AuthStore): Router;
//# sourceMappingURL=jobs.d.ts.map