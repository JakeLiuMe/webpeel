/**
 * Page actions executor for browser automation
 */
import type { Page } from 'playwright';
export interface PageAction {
    type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';
    selector?: string;
    value?: string;
    key?: string;
    ms?: number;
    to?: 'top' | 'bottom' | number;
    timeout?: number;
}
export declare function executeActions(page: Page, actions: PageAction[]): Promise<Buffer | undefined>;
//# sourceMappingURL=actions.d.ts.map