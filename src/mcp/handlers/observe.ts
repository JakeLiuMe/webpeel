/**
 * handleObserve — give agents structured "eyes" on a web page.
 *
 * Returns interactive elements (links, buttons, inputs, forms) so agents
 * can discover what's actionable before deciding what to do.
 */

import { textResult, safeStringify, timeout, type McpHandler } from './types.js';

export const handleObserve: McpHandler = async (args, _ctx?) => {
  const url = args['url'] as string;
  if (!url || typeof url !== 'string') throw new Error('url is required');
  if (url.length > 2048) throw new Error('URL too long (max 2048 characters)');

  const selector = args['selector'] as string | undefined;
  const screenshot = Boolean(args['screenshot']);
  const maxElements = typeof args['max_elements'] === 'number' ? args['max_elements'] : 50;
  const stealth = Boolean(args['stealth']);

  // Resolve viewport
  let viewport: 'desktop' | 'mobile' | 'tablet' = 'desktop';
  const vpArg = args['viewport'];
  if (vpArg === 'mobile' || vpArg === 'tablet') viewport = vpArg;

  const { observe } = await import('../../core/observe.js');

  const result = await Promise.race([
    observe({
      url,
      selector,
      viewport,
      screenshot,
      maxElements,
      timeout: 60000,
      stealth,
    }),
    timeout<never>(90000, 'Observe'),
  ]) as import('../../core/observe.js').ObserveResult;

  return textResult(safeStringify(result));
};
