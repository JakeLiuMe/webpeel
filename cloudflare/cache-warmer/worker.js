/**
 * Cloudflare Worker — Smart Cache Pre-Warmer
 *
 * Cron trigger: every 2 minutes  (see wrangler.toml)
 *
 * Flow:
 *  1. Fetch /internal/popular-urls from the WebPeel API
 *  2. For each URL, fetch /r/<url> through our CF proxy
 *  3. Cloudflare automatically caches the response at the nearest edge PoP
 *
 * Why run on Cloudflare rather than Render?
 *  - Runs on CF's edge — zero load on the Render origin
 *  - Free tier: 100K requests/day (we use ~36K @ 50 URLs × 12 runs/hr)
 *  - No cold-start delays; cron Workers wake in <1 ms
 *
 * Required secrets (set via `wrangler secret put`):
 *   CACHE_WARM_SECRET — matches the server-side CACHE_WARM_SECRET env var
 *
 * Required vars (in wrangler.toml [vars] or Worker dashboard):
 *   API_URL — base URL of the WebPeel API (default: https://api.webpeel.dev)
 */

export default {
  /**
   * scheduled — invoked by the CF cron trigger.
   *
   * @param {ScheduledEvent}    event
   * @param {object}            env    — Worker env bindings (vars + secrets)
   * @param {ExecutionContext}  ctx    — waitUntil / passThroughOnException
   */
  async scheduled(event, env, ctx) {
    const apiUrl = (env.API_URL || 'https://api.webpeel.dev').replace(/\/$/, '');
    const secret = env.CACHE_WARM_SECRET || '';

    console.log(`[cache-warmer] Starting warm cycle — api: ${apiUrl}`);

    // ── 1. Fetch popular URLs ──────────────────────────────────────────────
    let data;
    try {
      const resp = await fetch(`${apiUrl}/internal/popular-urls`, {
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        cf: { cacheEverything: false }, // never cache the URL list itself
      });

      if (!resp.ok) {
        console.error(`[cache-warmer] /internal/popular-urls returned ${resp.status}`);
        return;
      }

      data = await resp.json();
    } catch (err) {
      console.error('[cache-warmer] Failed to fetch popular URLs:', err?.message ?? err);
      return;
    }

    // Hard cap: never warm more than 50 URLs per run.
    // 50 URLs × 720 runs/day = 36,720 requests/day (37% of free 100K limit).
    // Going over 100K/day triggers billing at $0.30/million.
    const MAX_URLS_PER_RUN = 50;
    const urls = (data?.urls ?? []).slice(0, MAX_URLS_PER_RUN);
    if (urls.length === 0) {
      console.log('[cache-warmer] No URLs to warm — exiting');
      return;
    }

    // ── 2. Warm each URL in batches of 5 ──────────────────────────────────
    const batchSize = 5;
    let warmed = 0;
    let failed = 0;

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(({ url }) =>
          fetch(`${apiUrl}/r/${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': 'WebPeel-CacheWarmer/1.0' },
            // Tell CF to cache this response at the edge
            cf: {
              cacheEverything: true,
              cacheTtl: 300, // 5 minutes — matches our warm interval × 2.5
            },
          }),
        ),
      );

      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value.ok) {
          warmed++;
        } else {
          failed++;
          if (r.status === 'rejected') {
            console.warn('[cache-warmer] Fetch error:', r.reason?.message ?? r.reason);
          }
        }
      });
    }

    // ── 3. Report ──────────────────────────────────────────────────────────
    console.log(
      `[cache-warmer] Warmed ${warmed}/${urls.length} URLs` +
        (failed > 0 ? ` (${failed} failed)` : ''),
    );
  },
};
