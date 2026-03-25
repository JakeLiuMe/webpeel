import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 33. Polymarket extractor — prediction market data via public APIs
//     Supports: events, markets, profiles (@username), activity
// ---------------------------------------------------------------------------

// ── Shared helpers ────────────────────────────────────────────────────────────

const fmtPct = (p: string | number) => {
  const n = typeof p === 'string' ? parseFloat(p) : p;
  if (isNaN(n)) return '?%';
  return (n * 100).toFixed(1) + '%';
};

const fmtVol = (v: string | number) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n) || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

const fmtDate = (d: string) => {
  if (!d) return '?';
  return d.slice(0, 10);
};

const fmtNum = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
};

function timeAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

// ── Main extractor ────────────────────────────────────────────────────────────

export async function polymarketExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const path = urlObj.pathname;
  const domain = 'polymarket.com';

  // --- Profile: /@username or /profile/@username ---
  const profileUsernameMatch = path.match(/^\/(profile\/)?@([a-zA-Z0-9_.-]+)/);
  const profileAddressMatch = path.match(/^\/(profile\/)?(0x[a-fA-F0-9]{40})/);

  if (profileUsernameMatch || profileAddressMatch) {
    try {
      return await extractProfile(
        domain,
        profileUsernameMatch?.[2] || null,
        profileAddressMatch?.[2] || null,
      );
    } catch (e) {
      if (process.env.DEBUG) console.debug('[webpeel]', 'Polymarket profile fetch failed:', e instanceof Error ? e.message : e);
      return null; // Fall through to browser
    }
  }

  // --- Event page: /event/<slug> ---
  const eventMatch = path.match(/^\/event\/([^/?#]+)/);
  if (eventMatch) {
    return extractEvent(eventMatch[1]!, domain);
  }

  // --- Main/markets page ---
  const isRootOrMarkets = path === '/' || path === '' || path === '/markets' || path.startsWith('/markets?');
  if (isRootOrMarkets) {
    return extractMarkets(domain);
  }

  return null;
}

// ── Profile extractor ─────────────────────────────────────────────────────────

async function resolveWallet(username: string): Promise<string | null> {
  // Fetch the SSR HTML to extract proxyWallet from embedded Next.js data
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(`https://polymarket.com/@${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': 'webpeel/0.21 (https://webpeel.dev)',
        'Accept': 'text/html',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/"proxyWallet":"(0x[a-fA-F0-9]{40})"/);
    return match?.[1] || null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchAllActivity(wallet: string, maxTrades = 5000): Promise<any[]> {
  const allTrades: any[] = [];
  let offset = 0;
  const limit = 500;

  while (offset < maxTrades) {
    const batch = await fetchJson(
      `https://data-api.polymarket.com/activity?user=${wallet}&limit=${limit}&offset=${offset}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    allTrades.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return allTrades;
}

async function extractProfile(
  domain: string,
  username: string | null,
  walletAddress: string | null,
): Promise<DomainExtractResult | null> {
  // Step 1: Resolve wallet
  let wallet = walletAddress;
  if (!wallet && username) {
    wallet = await resolveWallet(username);
  }
  if (!wallet) return null;

  // Step 2: Parallel API calls
  const [profileData, statsData, leaderboardData, valueData, tradedData] = await Promise.all([
    fetchJson(`https://polymarket.com/api/profile/userData?address=${wallet}`).catch(() => null),
    fetchJson(`https://data-api.polymarket.com/v1/user-stats?proxyAddress=${wallet}`).catch(() => null),
    fetchJson(`https://data-api.polymarket.com/v1/leaderboard?timePeriod=all&orderBy=VOL&limit=1&user=${wallet}`).catch(() => null),
    fetchJson(`https://data-api.polymarket.com/value?user=${wallet}`).catch(() => null),
    fetchJson(`https://data-api.polymarket.com/traded?user=${wallet}`).catch(() => null),
  ]);

  // Step 3: Fetch positions + activity in parallel
  const [positions, activity] = await Promise.all([
    fetchJson(
      `https://data-api.polymarket.com/positions?user=${wallet}&sortBy=CURRENT&sortDirection=DESC&sizeThreshold=.1&limit=100&offset=0`
    ).catch(() => []),
    fetchAllActivity(wallet).catch(() => []),
  ]);

  // Extract data
  const lb = Array.isArray(leaderboardData) && leaderboardData.length > 0 ? leaderboardData[0] : null;
  const displayName = username || lb?.userName || profileData?.pseudonym || wallet.slice(0, 10) + '…';
  const xUsername = lb?.xUsername || null;
  const rank = lb?.rank ? `#${Number(lb.rank).toLocaleString('en-US')}` : '?';
  const totalVol = lb?.vol ? fmtVol(lb.vol) : '?';
  const pnl = lb?.pnl != null ? (lb.pnl >= 0 ? `+${fmtVol(lb.pnl)}` : `-${fmtVol(Math.abs(lb.pnl))}`) : '?';
  const trades = statsData?.trades ?? tradedData?.traded ?? '?';
  const largestWin = statsData?.largestWin ? fmtVol(statsData.largestWin) : '?';
  const views = statsData?.views ? fmtNum(statsData.views) : '?';
  const joinDate = statsData?.joinDate
    ? new Date(statsData.joinDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '?';

  // Build positions markdown
  let positionsMd = '';
  const posArr = Array.isArray(positions) ? positions : [];
  if (posArr.length > 0) {
    const posRows = posArr.slice(0, 30).map((p: any) => {
      const title = (p.title || p.eventTitle || '?').substring(0, 50);
      const side = p.outcome || '?';
      const shares = p.size != null ? Number(p.size).toFixed(1) : '?';
      const avgPrice = p.avgPrice != null ? `$${Number(p.avgPrice).toFixed(2)}` : '?';
      const curVal = p.currentValue != null ? fmtVol(p.currentValue) : (p.size && p.curPrice ? fmtVol(p.size * p.curPrice) : '?');
      return `| ${title} | ${side} | ${shares} | ${avgPrice} | ${curVal} |`;
    }).join('\n');
    positionsMd = `\n## Current Positions (${posArr.length})\n\n| Market | Side | Shares | Avg Price | Value |\n|--------|------|--------|-----------|-------|\n${posRows}\n`;
  }

  // Build activity markdown (last 50 for display)
  let activityMd = '';
  const actArr = Array.isArray(activity) ? activity : [];
  if (actArr.length > 0) {
    const actRows = actArr.slice(0, 50).map((t: any) => {
      const time = t.timestamp ? timeAgo(t.timestamp) : '?';
      const type = t.type === 'TRADE' ? (t.side === 'BUY' ? 'Buy' : 'Sell') : t.type || '?';
      const title = (t.title || '?').substring(0, 50);
      const amount = t.usdcSize != null ? fmtVol(t.usdcSize) : '?';
      return `| ${time} | ${type} | ${title} | ${amount} |`;
    }).join('\n');
    activityMd = `\n## Recent Activity (showing ${Math.min(actArr.length, 50)} of ${actArr.length} trades)\n\n| Time | Type | Market | Amount |\n|------|------|--------|--------|\n${actRows}\n`;
  }

  // Build activity summary
  let summaryMd = '';
  if (actArr.length > 0) {
    const timestamps = actArr.map((t: any) => t.timestamp).filter(Boolean);
    const oldest = timestamps.length ? new Date(Math.min(...timestamps) * 1000).toISOString().slice(0, 10) : '?';
    const newest = timestamps.length ? new Date(Math.max(...timestamps) * 1000).toISOString().slice(0, 10) : '?';
    const actVolume = actArr.reduce((sum: number, t: any) => sum + (Number(t.usdcSize) || 0), 0);

    // Volume by day
    const byDay: Record<string, number> = {};
    actArr.forEach((t: any) => {
      if (!t.timestamp) return;
      const day = new Date(t.timestamp * 1000).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + (Number(t.usdcSize) || 0);
    });
    const sortedDays = Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a));
    const topDays = sortedDays.slice(0, 7).map(([day, vol]) => `${day}: ${fmtVol(vol)}`).join(' · ');

    // Type breakdown
    const types: Record<string, number> = {};
    actArr.forEach((t: any) => { types[t.type || 'UNKNOWN'] = (types[t.type || 'UNKNOWN'] || 0) + 1; });
    const typeStr = Object.entries(types).map(([k, v]) => `${k}: ${v}`).join(', ');

    summaryMd = `\n## Activity Summary\n\n- **Trades fetched:** ${actArr.length.toLocaleString('en-US')} (${typeStr})\n- **Date range:** ${oldest} → ${newest}\n- **Volume (fetched trades):** ${fmtVol(actVolume)}\n- **Recent days:** ${topDays}\n`;
  }

  // X/Twitter line
  const xLine = xUsername ? ` | **X:** [@${xUsername}](https://x.com/${xUsername})` : '';

  const cleanContent = `# 📊 Polymarket Profile: @${displayName}

**Rank:** ${rank} | **Total Volume:** ${totalVol} | **P&L:** ${pnl}
**Trades:** ${typeof trades === 'number' ? trades.toLocaleString('en-US') : trades} | **Largest Win:** ${largestWin} | **Views:** ${views}
**Joined:** ${joinDate}${xLine}
${positionsMd}${activityMd}${summaryMd}
---
*Source: [Polymarket](https://polymarket.com/@${displayName}) · Data via Polymarket APIs*`;

  // Structured data: ALL raw data for programmatic use
  const structured: Record<string, any> = {
    username: displayName,
    wallet,
    profile: profileData || {},
    stats: statsData || {},
    leaderboard: lb || {},
    value: valueData || {},
    positions: posArr,
    activity: actArr,
    summary: {
      totalTrades: trades,
      totalVolume: lb?.vol ?? null,
      pnl: lb?.pnl ?? null,
      rank: lb?.rank ?? null,
      dateRange: actArr.length > 0 ? {
        from: new Date(Math.min(...actArr.map((t: any) => t.timestamp || Infinity)) * 1000).toISOString().slice(0, 10),
        to: new Date(Math.max(...actArr.map((t: any) => t.timestamp || 0)) * 1000).toISOString().slice(0, 10),
      } : null,
      volumeByDay: (() => {
        const byDay: Record<string, number> = {};
        actArr.forEach((t: any) => {
          if (!t.timestamp) return;
          const day = new Date(t.timestamp * 1000).toISOString().slice(0, 10);
          byDay[day] = (byDay[day] || 0) + (Number(t.usdcSize) || 0);
        });
        return byDay;
      })(),
    },
    fetchedAt: new Date().toISOString(),
  };

  return { domain, type: 'profile', structured, cleanContent };
}

// ── Event extractor ───────────────────────────────────────────────────────────

async function extractEvent(slug: string, domain: string): Promise<DomainExtractResult | null> {
  try {
    const events = await fetchJson(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}&limit=1`
    );

    if (Array.isArray(events) && events.length > 0) {
      const event = events[0];
      const markets: any[] = event.markets || [];

      const structured: Record<string, any> = {
        title: event.title || slug,
        slug: event.slug,
        volume: event.volume,
        volume24hr: event.volume24hr,
        endDate: event.endDate,
        markets: markets.map((m: any) => ({
          question: m.question,
          outcomes: m.outcomes,
          outcomePrices: m.outcomePrices,
          volume: m.volume,
          volume24hr: m.volume24hr,
          endDate: m.endDate,
          bestBid: m.bestBid,
          bestAsk: m.bestAsk,
          lastTradePrice: m.lastTradePrice,
        })),
      };

      const marketsMd = markets.map((m: any) => {
        const outcomes: string[] = JSON.parse(m.outcomes || '[]');
        const prices: string[] = JSON.parse(m.outcomePrices || '[]');
        const priceStr = outcomes.map((o, i) => `${o}: **${fmtPct(prices[i] ?? 0)}**`).join(' | ');
        const vol24 = m.volume24hr ? ` | Vol 24h: ${fmtVol(m.volume24hr)}` : '';
        const endDate = m.endDate ? ` | Ends: ${fmtDate(m.endDate)}` : '';
        return `- **${m.question}**\n  ${priceStr}${vol24}${endDate}`;
      }).join('\n\n');

      const totalVol24 = fmtVol(event.volume24hr || 0);
      const totalVol = fmtVol(event.volume || 0);

      const cleanContent = `# 📊 Polymarket: ${event.title || slug}

**Volume (24h):** ${totalVol24} | **Total Volume:** ${totalVol} | **Ends:** ${fmtDate(event.endDate)}

## Markets

${marketsMd || '*No active markets found.*'}

---
*Source: [Polymarket](https://polymarket.com/event/${slug}) · Data via Polymarket Gamma API*`;

      return { domain, type: 'event', structured, cleanContent };
    }

    // Fallback: keyword search
    const markets = await fetchJson(
      `https://gamma-api.polymarket.com/markets?closed=false&limit=10&order=volume24hr&ascending=false&q=${encodeURIComponent(slug.replace(/-/g, ' '))}`
    );
    if (Array.isArray(markets) && markets.length > 0) {
      return buildPolymarketMarketList(markets, domain, `Search: ${slug}`);
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Polymarket event fetch failed:', e instanceof Error ? e.message : e);
  }

  return null;
}

// ── Markets list ──────────────────────────────────────────────────────────────

async function extractMarkets(domain: string): Promise<DomainExtractResult | null> {
  try {
    const markets = await fetchJson(
      'https://gamma-api.polymarket.com/markets?closed=false&limit=20&order=volume24hr&ascending=false'
    );
    if (Array.isArray(markets)) {
      return buildPolymarketMarketList(markets, domain, 'Top Markets');
    }
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Polymarket markets fetch failed:', e instanceof Error ? e.message : e);
  }
  return null;
}

function buildPolymarketMarketList(markets: any[], domain: string, title: string): DomainExtractResult {
  const rows = markets.slice(0, 15).map((m: any) => {
    const outcomes: string[] = (() => { try { return JSON.parse(m.outcomes || '[]'); } catch { return []; } })();
    const prices: string[] = (() => { try { return JSON.parse(m.outcomePrices || '[]'); } catch { return []; } })();

    const yesPrice = outcomes[0] ? fmtPct(prices[0] ?? 0) : '?%';
    const vol24 = fmtVol(m.volume24hr || 0);
    const end = m.endDate ? m.endDate.slice(0, 10) : '?';
    return `| ${m.question} | ${yesPrice} | ${vol24} | ${end} |`;
  }).join('\n');

  const structured: Record<string, any> = {
    markets: markets.slice(0, 15).map((m: any) => ({
      question: m.question,
      slug: m.slug,
      outcomePrices: m.outcomePrices,
      outcomes: m.outcomes,
      volume24hr: m.volume24hr,
      endDate: m.endDate,
    })),
    fetchedAt: new Date().toISOString(),
  };

  const cleanContent = `# 📊 Polymarket — ${title}

| Question | Yes Price | Vol 24h | End Date |
|----------|-----------|---------|----------|
${rows}

---
*Source: [Polymarket](https://polymarket.com) · Data via Polymarket Gamma API*`;

  return { domain, type: 'markets', structured, cleanContent };
}
