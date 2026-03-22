import { simpleFetch } from '../../core/fetcher.js';
import type { DomainExtractResult } from './types.js';
import { stripHtml, fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 5. Wikipedia extractor
// ---------------------------------------------------------------------------

/** Remove Wikipedia-specific noise from extracted content. */
function cleanWikipediaContent(content: string): string {
  return content
    // Remove [edit] links
    .replace(/\[edit\]/gi, '')
    // Remove citation brackets [1], [2], etc.
    .replace(/\[\d+\]/g, '')
    // Remove [citation needed], [verification], etc.
    .replace(/\[(citation needed|verification|improve this article|adding citations[^\]]*|when\?|where\?|who\?|clarification needed|dubious[^\]]*|failed verification[^\]]*|unreliable source[^\]]*)\]/gi, '')
    // Remove [Learn how and when to remove this message]
    .replace(/\[Learn how and when to remove this message\]/gi, '')
    // Clean up excess whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Max rows to extract from a single HTML table to prevent token explosion. */
const MAX_TABLE_ROWS = 50;

/**
 * Convert an HTML <table> string to a markdown pipe table.
 * Returns null if the table can't be meaningfully converted (e.g. layout table).
 * Handles colspan/rowspan by flattening, caps at MAX_TABLE_ROWS.
 */
function htmlTableToMarkdown(tableHtml: string): string | null {
  // Extract all rows
  const rowMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!rowMatches || rowMatches.length < 2) return null;

  // Parse a row into cell texts
  function parseRow(rowHtml: string): string[] {
    const cells: string[] = [];
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let m: RegExpExecArray | null;
    while ((m = cellRegex.exec(rowHtml)) !== null) {
      const colspanMatch = m[0].match(/colspan=["']?(\d+)/i);
      const span = colspanMatch ? Math.min(parseInt(colspanMatch[1], 10), 6) : 1;
      const text = stripHtml(m[1]).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
      cells.push(text);
      // Fill colspan with empty cells
      for (let s = 1; s < span; s++) cells.push('');
    }
    return cells;
  }

  // Detect header row: first row with <th> elements
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rowMatches.length, 3); i++) {
    if (/<th[\s>]/i.test(rowMatches[i])) {
      headerRowIdx = i;
      break;
    }
  }

  let headers: string[];
  let dataStartIdx: number;

  if (headerRowIdx >= 0) {
    headers = parseRow(rowMatches[headerRowIdx]);
    dataStartIdx = headerRowIdx + 1;
  } else {
    // No header row — use first row as header
    headers = parseRow(rowMatches[0]);
    dataStartIdx = 1;
  }

  if (headers.length < 2) return null;
  // Skip tables that look like layout (single column or no real content)
  if (headers.every(h => !h)) return null;

  const colCount = headers.length;
  const mdLines: string[] = [];

  // Header row
  mdLines.push('| ' + headers.map(h => h || ' ').join(' | ') + ' |');
  // Separator row
  mdLines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

  // Data rows (capped at MAX_TABLE_ROWS)
  let rowCount = 0;
  for (let r = dataStartIdx; r < rowMatches.length && rowCount < MAX_TABLE_ROWS; r++) {
    const cells = parseRow(rowMatches[r]);
    if (cells.length === 0) continue;
    // Pad or trim to match column count
    while (cells.length < colCount) cells.push('');
    const row = cells.slice(0, colCount);
    // Skip completely empty rows
    if (row.every(c => !c)) continue;
    mdLines.push('| ' + row.map(c => c || ' ').join(' | ') + ' |');
    rowCount++;
  }

  if (rowCount === 0) return null;

  const truncNote = (rowMatches.length - dataStartIdx > MAX_TABLE_ROWS)
    ? `\n\n*Table truncated to ${MAX_TABLE_ROWS} rows.*`
    : '';

  return mdLines.join('\n') + truncNote;
}

/**
 * Extract wikitables from raw Wikipedia HTML.
 * Returns markdown for data tables (class="wikitable"), ignoring navboxes/infoboxes/layout tables.
 */
function extractWikitables(html: string): string[] {
  const tables: string[] = [];
  // Match tables with class="wikitable" — these are always data tables on Wikipedia
  const tableRegex = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(html)) !== null) {
    const fullTable = match[0];
    // Skip navboxes and sidebar tables
    if (/navbox|sidebar|metadata/i.test(fullTable.slice(0, 200))) continue;

    // Try to extract a caption
    const captionMatch = fullTable.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch ? stripHtml(captionMatch[1]).trim() : '';

    const md = htmlTableToMarkdown(fullTable);
    if (md) {
      const prefix = caption ? `**${caption}**\n\n` : '';
      tables.push(prefix + md);
    }
  }
  return tables;
}

export async function wikipediaExtractor(_html: string, url: string, options?: { budget?: number }): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  // Only handle article pages: /wiki/Article_Title
  if (pathParts[0] !== 'wiki' || pathParts.length < 2) return null;

  const articleTitle = decodeURIComponent(pathParts[1]);
  // Skip special pages (contain a colon, e.g. Special:Random, Talk:Article)
  if (articleTitle.includes(':')) return null;

  // For list/comparison/data-heavy articles, skip the summary API entirely.
  // The summary API only returns paragraph text — no tables. Return null so the
  // normal HTML→markdown pipeline fetches the full page and preserves tables.
  const isListArticle = /^List_of|^Lists_of|^Comparison_of|^List_/i.test(articleTitle);
  if (isListArticle) return null;

  const lang = urlObj.hostname.split('.')[0] || 'en';
  const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;

  // Wikipedia REST API requires a descriptive User-Agent (https://meta.wikimedia.org/wiki/User-Agent_policy)
  const wikiHeaders = { 'User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me) Node.js', 'Api-User-Agent': 'WebPeel/0.17.1 (https://webpeel.dev; jake@jakeliu.me)' };

  // Detect data-heavy pages: "List of ...", "Comparison of ...", tables in the raw HTML
  const isListPage = /^List[_ ]of[_ ]/i.test(articleTitle) || /^Comparison[_ ]of[_ ]/i.test(articleTitle);
  const rawHasWikitables = _html && /class="[^"]*wikitable/i.test(_html);
  const hasTableData = isListPage || rawHasWikitables;

  try {
    const data = await fetchJson(summaryUrl, wikiHeaders);
    if (!data || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') return null;

    const structured: Record<string, any> = {
      title: data.title || articleTitle.replace(/_/g, ' '),
      description: data.description || '',
      extract: data.extract || '',
      extractHtml: data.extract_html || '',
      thumbnail: data.thumbnail?.source || null,
      url: data.content_urls?.desktop?.page || url,
      lastModified: data.timestamp || null,
      coordinates: data.coordinates || null,
    };

    // Default: use summary API (200-400 tokens). Only fetch full article if budget > 5000.
    const budget = options?.budget ?? 0;
    const useFull = budget > 5000;

    let bodyContent = structured.extract;
    let mobileHtmlSize: number | undefined;
    let tableSections: string[] = [];

    // Extract tables from the raw HTML we already have (no extra API call needed)
    if (hasTableData && _html) {
      tableSections = extractWikitables(_html);
    }

    if (useFull) {
      try {
        const fullUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(articleTitle)}`;
        const fullResult = await simpleFetch(fullUrl, undefined, 15000, {
          ...wikiHeaders,
          'Accept': 'text/html',
        });
        if (fullResult?.html) {
          mobileHtmlSize = fullResult.html.length;
          let fullContent = '';
          const sectionMatches = fullResult.html.match(/<section[^>]*>([\s\S]*?)<\/section>/gi) || [];
          for (const section of sectionMatches) {
            const headingMatch = section.match(/<h[2-6][^>]*id="([^"]*)"[^>]*class="[^"]*pcs-edit-section-title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/i);
            const heading = headingMatch ? stripHtml(headingMatch[2]).trim() : '';
            const paragraphs = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
            const sectionText = paragraphs.map((p: string) => stripHtml(p).trim()).filter((t: string) => t.length > 0).join('\n\n');
            if (sectionText) {
              const prefix = heading ? `## ${heading}\n\n` : '';
              fullContent += `\n\n${prefix}${sectionText}`;
            }
          }
          bodyContent = cleanWikipediaContent(fullContent) || structured.extract;

          // Also extract tables from mobile-html if we didn't get them from raw HTML
          if (tableSections.length === 0) {
            tableSections = extractWikitables(fullResult.html);
          }
        }
      } catch (e) {
        if (process.env.DEBUG) console.debug('[webpeel]', 'Wikipedia mobile-html failed, using summary:', e instanceof Error ? e.message : e);
      }
    }

    const articleUrl = structured.url;
    const lines: string[] = [
      `# ${structured.title}`,
      '',
    ];
    if (structured.description) lines.push(`*${structured.description}*`, '');
    lines.push(bodyContent);

    // Append extracted tables
    if (tableSections.length > 0) {
      lines.push('', '---', '');
      for (const table of tableSections) {
        lines.push(table, '');
      }
    }

    if (structured.coordinates) {
      lines.push('', `📍 Coordinates: ${structured.coordinates.lat}, ${structured.coordinates.lon}`);
    }
    lines.push('', `📖 [Read full article on Wikipedia](${articleUrl})`);

    const cleanContent = lines.join('\n');
    return { domain: 'wikipedia.org', type: 'article', structured, cleanContent, rawHtmlSize: mobileHtmlSize };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Wikipedia API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

