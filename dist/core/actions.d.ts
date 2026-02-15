/**
 * Page actions executor for browser automation
 *
 * This is WebPeel's "Actions API" — click/scroll/type/wait before extracting.
 *
 * Timeouts:
 * - Default per action: 5s
 * - Max total across all actions: 30s
 */
import type { Page } from 'playwright';
import type { PageAction } from '../types.js';
export declare const DEFAULT_ACTION_TIMEOUT_MS = 5000;
export declare const MAX_TOTAL_ACTIONS_MS = 30000;
/**
 * Normalize a raw actions array to WebPeel's internal PageAction shape.
 * Accepts Firecrawl-style fields (milliseconds, text, direction/amount).
 */
export declare function normalizeActions(input?: unknown): PageAction[] | undefined;
export declare function executeActions(page: Page, actions: PageAction[], screenshotOptions?: {
    fullPage?: boolean;
    type?: 'png' | 'jpeg';
    quality?: number;
}): Promise<Buffer | undefined>;
//# sourceMappingURL=actions.d.ts.map