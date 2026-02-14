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

export async function executeActions(page: Page, actions: PageAction[]): Promise<Buffer | undefined> {
  let lastScreenshot: Buffer | undefined;
  
  for (const action of actions) {
    switch (action.type) {
      case 'wait':
        await page.waitForTimeout(action.ms || 1000);
        break;
      case 'click':
        if (!action.selector) throw new Error('click action requires selector');
        await page.click(action.selector, { timeout: action.timeout || 5000 });
        break;
      case 'scroll':
        if (action.to === 'bottom') {
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        } else if (action.to === 'top') {
          await page.evaluate('window.scrollTo(0, 0)');
        } else if (typeof action.to === 'number') {
          await page.evaluate(`window.scrollTo(0, ${action.to})`);
        } else {
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        }
        break;
      case 'type':
        if (!action.selector || !action.value) throw new Error('type action requires selector and value');
        await page.type(action.selector, action.value);
        break;
      case 'fill':
        if (!action.selector || !action.value) throw new Error('fill action requires selector and value');
        await page.fill(action.selector, action.value);
        break;
      case 'select':
        if (!action.selector || !action.value) throw new Error('select action requires selector and value');
        await page.selectOption(action.selector, action.value);
        break;
      case 'press':
        if (!action.key) throw new Error('press action requires key');
        await page.keyboard.press(action.key);
        break;
      case 'hover':
        if (!action.selector) throw new Error('hover action requires selector');
        await page.hover(action.selector);
        break;
      case 'waitForSelector':
        if (!action.selector) throw new Error('waitForSelector action requires selector');
        await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
        break;
      case 'screenshot':
        lastScreenshot = await page.screenshot({ fullPage: true, type: 'png' });
        break;
    }
  }
  
  return lastScreenshot;
}
