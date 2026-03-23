/**
 * WebPeel LlamaIndex Reader (TypeScript)
 *
 * Usage:
 *   import { WebPeelReader } from 'webpeel/integrations/llamaindex/ts';
 *   const reader = new WebPeelReader({ apiKey: 'wp_...' });
 *   const documents = await reader.loadData('https://example.com');
 */

interface WebPeelReaderOptions {
  apiKey?: string;
  apiUrl?: string;
  render?: boolean;
}

class WebPeelReader {
  private apiKey: string;
  private apiUrl: string;
  private render: boolean;

  constructor(options: WebPeelReaderOptions = {}) {
    this.apiKey = options.apiKey || process.env.WEBPEEL_API_KEY || '';
    this.apiUrl = (options.apiUrl || 'https://api.webpeel.dev').replace(/\/$/, '');
    this.render = options.render || false;
  }

  async loadData(urls: string | string[]): Promise<Array<{ text: string; metadata: Record<string, unknown> }>> {
    const urlList = Array.isArray(urls) ? urls : [urls];
    const results = await Promise.all(urlList.map(async (url) => {
      const params = new URLSearchParams({ url });
      if (this.render) params.set('render', 'true');

      const response = await fetch(`${this.apiUrl}/v1/fetch?${params.toString()}`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      });
      if (!response.ok && response.status !== 202) {
        return {
          text: '',
          metadata: { source: url, error: `HTTP ${response.status} ${response.statusText}` },
        };
      }
      let data = await response.json() as Record<string, unknown>;
      
      // Handle async job queue (202 Accepted with jobId)
      if (data.jobId && data.pollUrl) {
        const pollUrl = `${this.apiUrl}${data.pollUrl}`;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const pollResp = await fetch(pollUrl, {
            headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
          });
          const pollData = await pollResp.json() as Record<string, unknown>;
          if (pollData.status === 'completed' || pollData.content) {
            data = (pollData.result as Record<string, unknown>) || (pollData.data as Record<string, unknown>) || pollData;
            break;
          }
          if (pollData.status === 'failed') break;
        }
      }
      return {
        text: (data.content as string) || '',
        metadata: {
          source: (data.url as string) || url,
          title: (data.title as string) || '',
          tokens: (data.tokens as number) || 0,
        },
      };
    }));
    return results;
  }
}

export { WebPeelReader };
export default WebPeelReader;
