/**
 * Affiliate link cloaker — /go/:store/:path
 * 
 * Redirects through our domain so users see webpeel.dev/go/amazon/...
 * instead of amazon.com/dp/...?tag=wp0b7-20
 * 
 * Examples:
 *   /go/amazon/dp/B0D1XD1ZV3 → amazon.com/dp/B0D1XD1ZV3?tag=wp0b7-20
 *   /go/walmart/ip/123456    → walmart.com/ip/123456?wmlspartner=...
 *   /go/booking/hotel/hilton → booking.com/hotel/hilton?aid=...
 *   /go?url=https://amazon.com/dp/B0... → adds affiliate tag + redirects
 */

import { Router, Request, Response } from 'express';

// Store configs: domain + affiliate param + env var
const STORES: Record<string, { domain: string; param: string; envVar: string }> = {
  amazon:    { domain: 'www.amazon.com',    param: 'tag',         envVar: 'AMAZON_AFFILIATE_TAG' },
  walmart:   { domain: 'www.walmart.com',   param: 'wmlspartner', envVar: 'WALMART_AFFILIATE_ID' },
  bestbuy:   { domain: 'www.bestbuy.com',   param: 'ref',         envVar: 'BESTBUY_AFFILIATE_ID' },
  target:    { domain: 'www.target.com',    param: 'afid',        envVar: 'TARGET_AFFILIATE_ID' },
  ebay:      { domain: 'www.ebay.com',      param: 'campid',      envVar: 'EBAY_AFFILIATE_ID' },
  etsy:      { domain: 'www.etsy.com',      param: 'ref',         envVar: 'ETSY_AFFILIATE_ID' },
  booking:   { domain: 'www.booking.com',   param: 'aid',         envVar: 'BOOKING_AFFILIATE_ID' },
  kayak:     { domain: 'www.kayak.com',     param: 'affid',       envVar: 'KAYAK_AFFILIATE_ID' },
  expedia:   { domain: 'www.expedia.com',   param: 'affcid',      envVar: 'EXPEDIA_AFFILIATE_ID' },
};

export function createGoRouter(): Router {
  const router = Router();

  // Route 1: /go?url=https://amazon.com/dp/... (raw URL redirect)
  // Route 2: /go/:store/*path (clean path redirect)
  
  router.get('/go', (req: Request, res: Response) => {
    const rawUrl = req.query.url as string;
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing ?url= parameter' });
      return;
    }

    try {
      const parsed = new URL(rawUrl);
      const hostname = parsed.hostname.replace('www.', '');
      
      // Find matching store and add affiliate tag
      for (const [, config] of Object.entries(STORES)) {
        const storeDomain = config.domain.replace('www.', '');
        if (hostname === storeDomain || hostname.endsWith('.' + storeDomain)) {
          const tag = process.env[config.envVar];
          if (tag) {
            parsed.searchParams.set(config.param, tag);
          }
          break;
        }
      }
      
      res.redirect(301, parsed.toString());
    } catch {
      res.redirect(301, rawUrl);
    }
  });

  router.get('/go/:store/*', (req: Request, res: Response) => {
    const store = String(req.params.store || "").toLowerCase();
    const path = req.params[0] || '';
    
    const config = STORES[store];
    if (!config) {
      res.status(404).json({ error: `Unknown store: ${store}` });
      return;
    }
    
    // Build the target URL
    const targetUrl = new URL(`https://${config.domain}/${path}`);
    
    // Copy query params from the request
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        targetUrl.searchParams.set(key, value);
      }
    }
    
    // Add affiliate tag
    const tag = process.env[config.envVar];
    if (tag) {
      targetUrl.searchParams.set(config.param, tag);
    }
    
    // 301 redirect — browser goes directly to store
    res.redirect(301, targetUrl.toString());
  });

  return router;
}
