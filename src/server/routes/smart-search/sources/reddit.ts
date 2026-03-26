import { getBestSearchProvider } from '../../../../core/search-provider.js';

export async function fetchRedditResults(keyword: string, location: string) {
  const { provider } = getBestSearchProvider();
  const results = await provider.searchWeb(`${keyword} ${location} site:reddit.com`, { count: 3 });
  if (results.length === 0) {
    return { source: 'reddit' as const, thread: null, otherThreads: [] };
  }
  const topThread = results[0];
  let threadContent: string | null = null;
  try {
    const jsonUrl = topThread.url.replace(/\/?$/, '.json') + '?limit=10&sort=top';
    const res = await fetch(jsonUrl, {
      headers: { 'User-Agent': 'WebPeel/0.21 (+https://webpeel.dev/bot)' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      const op = data?.[0]?.data?.children?.[0]?.data;
      const opText = op?.selftext?.substring(0, 500) || '';
      const comments = (data?.[1]?.data?.children || [])
        .filter((c: any) => c.data?.body && c.data.score > 1)
        .slice(0, 3)
        .map((c: any) => c.data.body.substring(0, 200))
        .join('\n\n');
      threadContent = `${opText}\n\nTop comments:\n${comments}`.trim();
    }
  } catch { /* JSON API failed */ }
  return {
    source: 'reddit' as const,
    thread: { title: topThread.title, url: topThread.url, content: threadContent || topThread.snippet || null, structured: null },
    otherThreads: results.slice(1).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
  };
}
