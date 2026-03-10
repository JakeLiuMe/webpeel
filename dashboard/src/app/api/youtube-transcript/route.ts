import { NextRequest, NextResponse } from 'next/server';

/**
 * YouTube transcript extraction — multi-strategy approach:
 * 
 * Strategy 1: Extract caption tracks from page HTML (ytInitialPlayerResponse)
 *             then fetch caption XML with cookies + Android UA
 * Strategy 2: ANDROID InnerTube player API (works for manually-captioned videos)
 * Strategy 3: get_transcript InnerTube endpoint (returns transcript in JSON)
 * 
 * GET /api/youtube-transcript?url=https://youtube.com/watch?v=...
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
  }

  const start = Date.now();
  const errors: string[] = [];

  // Step 1: Fetch video page HTML (needed for all strategies)
  let html = '';
  try {
    const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
      },
      signal: AbortSignal.timeout(10000),
    });
    html = await pageResp.text();
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to fetch video page: ${e.message}`, elapsed: Date.now() - start }, { status: 502 });
  }

  // Extract metadata
  const title = html.match(/"title":"([^"]+)"/)?.[1] ?? '';
  const channel = html.match(/"author":"([^"]+)"/)?.[1] ?? '';
  const lengthSec = parseInt(html.match(/"lengthSeconds":"(\d+)"/)?.[1] ?? '0', 10);
  let duration = '';
  if (lengthSec > 0) {
    const h = Math.floor(lengthSec / 3600);
    const m = Math.floor((lengthSec % 3600) / 60);
    const s = lengthSec % 60;
    duration = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }
  const description = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\n/g, '\n') ?? '';
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? '';

  // ── Strategy 1: Extract caption tracks from page HTML ─────────────────
  const captionTracksMatch = html.match(/"captionTracks":(\[.*?\])/);
  if (captionTracksMatch) {
    try {
      const tracks = JSON.parse(captionTracksMatch[1]);
      const track = tracks.find((t: any) => t.languageCode === 'en') || tracks[0];

      if (track?.baseUrl) {
        const baseUrl = track.baseUrl.replace(/\\u0026/g, '&');

        // Try fetching with various strategies
        const xmlResult = await tryFetchCaptionXml(baseUrl);
        if (xmlResult) {
          const segments = parseXmlToSegments(xmlResult);
          if (segments.length > 0) {
            const elapsed = Date.now() - start;
            return buildSuccessResponse(videoId, title, channel, duration, description, track.languageCode, segments, elapsed, 'html-extract');
          }
        }
        errors.push('Strategy 1: Caption XML empty from cloud IP');
      }
    } catch (e: any) {
      errors.push(`Strategy 1: ${e.message}`);
    }
  }

  // ── Strategy 2: ANDROID InnerTube player API ──────────────────────────
  if (apiKey) {
    try {
      const playerResp = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
          videoId,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const player = await playerResp.json();
      const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (tracks?.length) {
        const track = tracks.find((t: any) => t.languageCode === 'en') || tracks[0];
        const baseUrl = track.baseUrl.replace(/\\u0026/g, '&');

        const xml = await tryFetchCaptionXml(baseUrl);
        if (xml) {
          const segments = parseXmlToSegments(xml);
          if (segments.length > 0) {
            const elapsed = Date.now() - start;
            return buildSuccessResponse(videoId, title, channel, duration, description, track.languageCode, segments, elapsed, 'android-innertube');
          }
        }
        errors.push('Strategy 2: Caption XML empty');
      } else {
        errors.push('Strategy 2: No caption tracks from ANDROID client');
      }
    } catch (e: any) {
      errors.push(`Strategy 2: ${e.message}`);
    }
  }

  // ── Strategy 3: get_transcript InnerTube endpoint ─────────────────────
  if (apiKey) {
    try {
      // Construct params: base64-encoded protobuf with video ID
      const params = constructTranscriptParams(videoId);

      const transcriptResp = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20240313' } },
          params,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await transcriptResp.json();

      // Navigate the response structure
      const content = data?.actions?.[0]?.updateEngagementPanelAction?.content;
      const body = content?.transcriptRenderer?.body?.transcriptBodyRenderer;
      const cueGroups = body?.cueGroups;

      if (cueGroups?.length) {
        const segments = cueGroups.map((group: any) => {
          const cue = group?.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer;
          return {
            text: cue?.cue?.simpleText ?? '',
            start: parseInt(cue?.startOffsetMs ?? '0', 10) / 1000,
            duration: parseInt(cue?.durationMs ?? '0', 10) / 1000,
          };
        }).filter((s: any) => s.text);

        if (segments.length > 0) {
          const elapsed = Date.now() - start;
          return buildSuccessResponse(videoId, title, channel, duration, description, 'en', segments, elapsed, 'get_transcript');
        }
      }
      errors.push('Strategy 3: No cueGroups in get_transcript response');
    } catch (e: any) {
      errors.push(`Strategy 3: ${e.message}`);
    }
  }

  // All strategies failed
  const elapsed = Date.now() - start;
  return NextResponse.json({
    error: 'All transcript extraction strategies failed',
    strategies: errors,
    elapsed,
  }, { status: 502 });
}

/** Try fetching caption XML with multiple approaches */
async function tryFetchCaptionXml(baseUrl: string): Promise<string | null> {
  const attempts = [
    // Attempt 1: Android UA + cookies
    {
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
    },
    // Attempt 2: Chrome UA + cookies
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Cookie': 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTE1LjA3X3AxGgJlbiADGgYIgLv3tQY; CONSENT=PENDING+987',
    },
    // Attempt 3: Bare fetch (no special headers)
    {},
  ];

  for (const headers of attempts) {
    try {
      const resp = await fetch(baseUrl, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      const xml = await resp.text();
      if (xml && xml.length > 100 && xml.includes('<text')) {
        return xml;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function parseXmlToSegments(xml: string): Array<{ text: string; start: number; duration: number }> {
  const segments: Array<{ text: string; start: number; duration: number }> = [];
  const textRegex = /<text\s+start="([^"]+)"\s+dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = textRegex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[3]!.replace(/\n/g, ' ').trim());
    if (text) {
      segments.push({
        text,
        start: parseFloat(match[1]!),
        duration: parseFloat(match[2]!),
      });
    }
  }
  return segments;
}

function buildSuccessResponse(
  videoId: string, title: string, channel: string, duration: string,
  description: string, language: string,
  segments: Array<{ text: string; start: number; duration: number }>,
  elapsed: number, method: string,
) {
  const fullText = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  return NextResponse.json({
    success: true,
    videoId, title, channel, duration, language,
    segments, fullText, wordCount,
    description: description.substring(0, 500),
    elapsed, method,
  });
}

function constructTranscriptParams(videoId: string): string {
  // Protobuf encoding for get_transcript params
  // Field 1 (string) = video ID, wrapped in field 1 of outer message
  const videoIdBytes = new TextEncoder().encode(videoId);
  const innerPayload = new Uint8Array(2 + videoIdBytes.length);
  innerPayload[0] = 0x0a; // field 1, wire type 2 (length-delimited)
  innerPayload[1] = videoIdBytes.length;
  innerPayload.set(videoIdBytes, 2);

  const outerPayload = new Uint8Array(2 + innerPayload.length);
  outerPayload[0] = 0x0a; // field 1, wire type 2
  outerPayload[1] = innerPayload.length;
  outerPayload.set(innerPayload, 2);

  return btoa(String.fromCharCode(...outerPayload));
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}
