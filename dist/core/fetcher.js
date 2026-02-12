/**
 * Core fetching logic: simple HTTP and browser-based fetching
 */
import { chromium } from 'playwright';
import { TimeoutError, BlockedError, NetworkError, WebPeelError } from '../types.js';
const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
/**
 * SECURITY: Validate URL to prevent SSRF attacks
 * Blocks localhost, private IPs, and link-local addresses
 */
function validateUrl(urlString) {
    // Length check
    if (urlString.length > 2048) {
        throw new WebPeelError('URL too long (max 2048 characters)');
    }
    let url;
    try {
        url = new URL(urlString);
    }
    catch {
        throw new WebPeelError('Invalid URL format');
    }
    // Only allow HTTP(S)
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new WebPeelError('Only HTTP and HTTPS protocols are allowed');
    }
    const hostname = url.hostname.toLowerCase();
    // Block localhost
    const localhostPatterns = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
    if (localhostPatterns.some(pattern => hostname === pattern || hostname.endsWith('.' + pattern))) {
        throw new WebPeelError('Access to localhost is not allowed');
    }
    // Block private IP ranges and link-local
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    if (match) {
        const octets = match.slice(1).map(Number);
        // Check for private ranges
        if (octets[0] === 10 || // 10.0.0.0/8
            (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || // 172.16.0.0/12
            (octets[0] === 192 && octets[1] === 168) || // 192.168.0.0/16
            (octets[0] === 169 && octets[1] === 254) // 169.254.0.0/16 (link-local)
        ) {
            throw new WebPeelError('Access to private IP addresses is not allowed');
        }
    }
    // Block IPv6 private addresses (simplified check)
    if (hostname.includes(':') && (hostname.startsWith('fc') || hostname.startsWith('fd'))) {
        throw new WebPeelError('Access to private IPv6 addresses is not allowed');
    }
}
/**
 * Validate and sanitize user agent string
 */
function validateUserAgent(userAgent) {
    if (userAgent.length > 500) {
        throw new WebPeelError('User agent too long (max 500 characters)');
    }
    // Allow only printable ASCII characters
    if (!/^[\x20-\x7E]*$/.test(userAgent)) {
        throw new WebPeelError('User agent contains invalid characters');
    }
    return userAgent;
}
/**
 * Simple HTTP fetch using native fetch + Cheerio
 * Fast and lightweight, but can be blocked by Cloudflare/bot detection
 */
export async function simpleFetch(url, userAgent, timeoutMs = 30000) {
    // SECURITY: Validate URL to prevent SSRF
    validateUrl(url);
    // Validate user agent if provided
    const validatedUserAgent = userAgent ? validateUserAgent(userAgent) : getRandomUserAgent();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': validatedUserAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            signal: controller.signal,
            redirect: 'follow',
        });
        clearTimeout(timer);
        if (!response.ok) {
            if (response.status === 403 || response.status === 503) {
                throw new BlockedError(`HTTP ${response.status}: Site may be blocking requests. Try --render for browser mode.`);
            }
            throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
        }
        // SECURITY: Validate Content-Type
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
            throw new WebPeelError(`Unsupported content type: ${contentType}. Only HTML is supported.`);
        }
        const html = await response.text();
        // SECURITY: Limit HTML size
        if (html.length > 10 * 1024 * 1024) { // 10MB limit
            throw new WebPeelError('Response too large (max 10MB)');
        }
        if (!html || html.length < 100) {
            throw new BlockedError('Empty or suspiciously small response. Site may require JavaScript.');
        }
        // Check for Cloudflare challenge
        if (html.includes('cf-browser-verification') || html.includes('Just a moment...')) {
            throw new BlockedError('Cloudflare challenge detected. Try --render for browser mode.');
        }
        return {
            html,
            url: response.url,
            statusCode: response.status,
        };
    }
    catch (error) {
        clearTimeout(timer);
        if (error instanceof BlockedError || error instanceof NetworkError || error instanceof WebPeelError) {
            throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
            throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
        }
        throw new NetworkError(`Failed to fetch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
let sharedBrowser = null;
let activePagesCount = 0;
const MAX_CONCURRENT_PAGES = 5;
async function getBrowser() {
    // SECURITY: Check if browser is still connected and healthy
    if (sharedBrowser) {
        try {
            if (sharedBrowser.isConnected()) {
                return sharedBrowser;
            }
        }
        catch {
            // Browser is dead, recreate
            sharedBrowser = null;
        }
    }
    sharedBrowser = await chromium.launch({ headless: true });
    return sharedBrowser;
}
/**
 * Fetch using headless Chromium via Playwright
 * Slower but can handle JavaScript-heavy sites and bypass some bot detection
 */
export async function browserFetch(url, options = {}) {
    // SECURITY: Validate URL to prevent SSRF
    validateUrl(url);
    const { userAgent, waitMs = 0, timeoutMs = 30000 } = options;
    // Validate user agent if provided
    const validatedUserAgent = userAgent ? validateUserAgent(userAgent) : getRandomUserAgent();
    // Validate wait time
    if (waitMs < 0 || waitMs > 60000) {
        throw new WebPeelError('Wait time must be between 0 and 60000ms');
    }
    // SECURITY: Limit concurrent browser pages
    while (activePagesCount >= MAX_CONCURRENT_PAGES) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    activePagesCount++;
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage({
            userAgent: validatedUserAgent,
        });
        // Block images, fonts, and other heavy resources for speed
        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
                route.abort();
            }
            else {
                route.continue();
            }
        });
        // SECURITY: Wrap entire operation in timeout
        const fetchPromise = (async () => {
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: timeoutMs,
            });
            // Wait for additional time if requested (for dynamic content)
            if (waitMs > 0) {
                await page.waitForTimeout(waitMs);
            }
            const html = await page.content();
            const finalUrl = page.url();
            return { html, finalUrl };
        })();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        const { html, finalUrl } = await Promise.race([fetchPromise, timeoutPromise]);
        // SECURITY: Limit HTML size
        if (html.length > 10 * 1024 * 1024) { // 10MB limit
            throw new WebPeelError('Response too large (max 10MB)');
        }
        if (!html || html.length < 100) {
            throw new BlockedError('Empty or suspiciously small response from browser.');
        }
        return {
            html,
            url: finalUrl,
        };
    }
    catch (error) {
        if (error instanceof BlockedError || error instanceof WebPeelError || error instanceof TimeoutError) {
            throw error;
        }
        if (error instanceof Error && error.message.includes('Timeout')) {
            throw new TimeoutError(`Browser navigation timed out`);
        }
        throw new NetworkError(`Browser fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    finally {
        // CRITICAL: Always close page and decrement counter
        if (page) {
            await page.close().catch(() => { });
        }
        activePagesCount--;
    }
}
/**
 * Retry a fetch operation with exponential backoff
 */
export async function retryFetch(fn, maxAttempts = 3, baseDelayMs = 1000) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error('Unknown error');
            // Don't retry on blocked errors or timeouts
            if (error instanceof BlockedError || error instanceof TimeoutError) {
                throw error;
            }
            if (attempt < maxAttempts) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError || new NetworkError('Retry failed');
}
/**
 * Clean up browser resources
 */
export async function cleanup() {
    if (sharedBrowser) {
        await sharedBrowser.close();
        sharedBrowser = null;
    }
}
//# sourceMappingURL=fetcher.js.map