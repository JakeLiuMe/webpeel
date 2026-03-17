/**
 * Tests for src/core/fetch-cache.ts
 *
 * Covers:
 * 1. Basic set/get
 * 2. TTL expiry
 * 3. LRU eviction
 * 4. Cache key generation (same URL, different options = different keys)
 * 5. noCache bypass (simulated at caller level)
 * 6. Stats tracking
 * 7. Clear
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FetchCache, fetchCache, searchCache } from '../core/fetch-cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(content = 'hello world') {
  return {
    content,
    title: 'Test Page',
    metadata: { author: 'Test' },
    method: 'simple',
    tokens: 42,
    links: ['https://example.com'],
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 1. Basic set/get
// ---------------------------------------------------------------------------

describe('FetchCache – basic set/get', () => {
  let cache: FetchCache;

  beforeEach(() => {
    cache = new FetchCache(100, 300);
  });

  it('stores and retrieves an entry', () => {
    const entry = makeEntry();
    cache.set('key1', entry);
    const result = cache.get('key1');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('hello world');
    expect(result!.title).toBe('Test Page');
  });

  it('returns null for a missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('overwrites an existing entry', () => {
    cache.set('key1', makeEntry('first'));
    cache.set('key1', makeEntry('second'));
    expect(cache.get('key1')!.content).toBe('second');
  });

  it('preserves all entry fields', () => {
    const entry = makeEntry();
    cache.set('key1', entry);
    const result = cache.get('key1')!;
    expect(result.title).toBe(entry.title);
    expect(result.metadata).toEqual(entry.metadata);
    expect(result.method).toBe(entry.method);
    expect(result.tokens).toBe(entry.tokens);
    expect(result.links).toEqual(entry.links);
  });
});

// ---------------------------------------------------------------------------
// 2. TTL expiry
// ---------------------------------------------------------------------------

describe('FetchCache – TTL expiry', () => {
  it('returns null after TTL has passed', async () => {
    // 0.05 second TTL
    const cache = new FetchCache(100, 0.05);
    const entry = makeEntry();
    cache.set('key1', entry);

    expect(cache.get('key1')).not.toBeNull(); // fresh

    await new Promise(r => setTimeout(r, 60)); // wait > 50ms

    expect(cache.get('key1')).toBeNull(); // expired
  });

  it('evicts the expired key from the map', async () => {
    const cache = new FetchCache(100, 0.05);
    cache.set('key1', makeEntry());
    await new Promise(r => setTimeout(r, 60));
    cache.get('key1'); // triggers eviction
    expect(cache.stats().size).toBe(0);
  });

  it('does not expire entries before TTL', async () => {
    const cache = new FetchCache(100, 10); // 10 second TTL
    cache.set('key1', makeEntry());
    await new Promise(r => setTimeout(r, 20));
    expect(cache.get('key1')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. LRU eviction
// ---------------------------------------------------------------------------

describe('FetchCache – LRU eviction', () => {
  it('evicts the least recently used entry when at capacity', () => {
    const cache = new FetchCache(3, 300); // max 3 entries

    cache.set('a', makeEntry('a'));
    cache.set('b', makeEntry('b'));
    cache.set('c', makeEntry('c'));

    // Access 'a' and 'b' to make 'c' the LRU... actually 'a' was inserted first
    // LRU = 'a' (oldest), so inserting 'd' should evict 'a'
    cache.set('d', makeEntry('d'));

    expect(cache.get('a')).toBeNull(); // evicted
    expect(cache.get('b')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.get('d')).not.toBeNull();
  });

  it('refreshes recency on get (touch)', () => {
    const cache = new FetchCache(3, 300);

    cache.set('a', makeEntry('a'));
    cache.set('b', makeEntry('b'));
    cache.set('c', makeEntry('c'));

    // Touch 'a' — it's no longer the LRU
    cache.get('a');

    // 'b' is now LRU; adding 'd' should evict 'b'
    cache.set('d', makeEntry('d'));

    expect(cache.get('b')).toBeNull(); // evicted
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.get('d')).not.toBeNull();
  });

  it('does not exceed maxEntries', () => {
    const cache = new FetchCache(5, 300);
    for (let i = 0; i < 20; i++) {
      cache.set(`key${i}`, makeEntry(`content${i}`));
    }
    expect(cache.stats().size).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 4. Cache key generation
// ---------------------------------------------------------------------------

describe('FetchCache – getKey', () => {
  let cache: FetchCache;

  beforeEach(() => {
    cache = new FetchCache();
  });

  it('generates the same key for identical url + options', () => {
    const k1 = cache.getKey('https://example.com', { render: true, stealth: false, budget: 4000 });
    const k2 = cache.getKey('https://example.com', { render: true, stealth: false, budget: 4000 });
    expect(k1).toBe(k2);
  });

  it('generates different keys for different URLs', () => {
    const k1 = cache.getKey('https://example.com');
    const k2 = cache.getKey('https://other.com');
    expect(k1).not.toBe(k2);
  });

  it('generates different keys when render flag differs', () => {
    const k1 = cache.getKey('https://example.com', { render: true });
    const k2 = cache.getKey('https://example.com', { render: false });
    expect(k1).not.toBe(k2);
  });

  it('generates different keys when stealth flag differs', () => {
    const k1 = cache.getKey('https://example.com', { stealth: true });
    const k2 = cache.getKey('https://example.com', { stealth: false });
    expect(k1).not.toBe(k2);
  });

  it('generates different keys when budget differs', () => {
    const k1 = cache.getKey('https://example.com', { budget: 1000 });
    const k2 = cache.getKey('https://example.com', { budget: 4000 });
    expect(k1).not.toBe(k2);
  });

  it('treats undefined and missing options as equivalent', () => {
    const k1 = cache.getKey('https://example.com', {});
    const k2 = cache.getKey('https://example.com');
    expect(k1).toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// 5. noCache bypass (simulated)
// ---------------------------------------------------------------------------

describe('FetchCache – noCache bypass pattern', () => {
  it('still writes to cache when noCache=true but reads are bypassed by caller', () => {
    const cache = new FetchCache(100, 300);
    const entry = makeEntry('result');
    const key = cache.getKey('https://example.com');

    // Simulate noCache=true: bypass read, but still write
    // (the caller is responsible for the bypass logic)
    cache.set(key, entry);

    // Next caller without noCache should hit
    const result = cache.get(key);
    expect(result).not.toBeNull();
    expect(result!.content).toBe('result');
  });

  it('cache returns null for a key that was never set', () => {
    const cache = new FetchCache(100, 300);
    const key = cache.getKey('https://example.com');
    expect(cache.get(key)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Stats tracking
// ---------------------------------------------------------------------------

describe('FetchCache – stats', () => {
  let cache: FetchCache;

  beforeEach(() => {
    cache = new FetchCache(100, 300);
  });

  it('starts with zero stats', () => {
    const s = cache.stats();
    expect(s.size).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.hitRate).toBe(0);
  });

  it('counts misses on missing keys', () => {
    cache.get('nope');
    cache.get('still-nope');
    expect(cache.stats().misses).toBe(2);
    expect(cache.stats().hits).toBe(0);
  });

  it('counts hits on existing keys', () => {
    cache.set('k', makeEntry());
    cache.get('k');
    cache.get('k');
    expect(cache.stats().hits).toBe(2);
  });

  it('calculates hit rate correctly', () => {
    cache.set('k', makeEntry());
    cache.get('k');   // hit
    cache.get('k');   // hit
    cache.get('nope'); // miss
    const s = cache.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(0.67, 1);
  });

  it('reports correct size', () => {
    cache.set('a', makeEntry());
    cache.set('b', makeEntry());
    expect(cache.stats().size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Clear
// ---------------------------------------------------------------------------

describe('FetchCache – clear', () => {
  let cache: FetchCache;

  beforeEach(() => {
    cache = new FetchCache(100, 300);
  });

  it('removes all entries', () => {
    cache.set('a', makeEntry());
    cache.set('b', makeEntry());
    cache.clear();
    expect(cache.stats().size).toBe(0);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });

  it('resets hit/miss stats', () => {
    cache.set('a', makeEntry());
    cache.get('a'); // hit
    cache.get('x'); // miss
    cache.clear();
    const s = cache.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.hitRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Singleton exports
// ---------------------------------------------------------------------------

describe('fetchCache and searchCache singletons', () => {
  it('fetchCache is a FetchCache instance', () => {
    expect(fetchCache).toBeInstanceOf(FetchCache);
  });

  it('searchCache is a FetchCache instance', () => {
    expect(searchCache).toBeInstanceOf(FetchCache);
  });

  it('singletons are different objects', () => {
    expect(fetchCache).not.toBe(searchCache);
  });
});
