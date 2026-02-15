/**
 * Screenshot endpoint — POST /v1/screenshot
 *
 * Takes a screenshot of a URL and returns base64-encoded image data.
 * Uses the same rate limiting / credit system as the fetch endpoint (1 credit).
 */
import { Router } from 'express';
import type { AuthStore } from '../auth-store.js';
export declare function createScreenshotRouter(authStore: AuthStore): Router;
//# sourceMappingURL=screenshot.d.ts.map