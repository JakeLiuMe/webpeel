/**
 * WebPeel Diff - Semantic content diff against stored snapshots
 *
 * Fetches the current content of a URL, loads the previous snapshot from the
 * change-tracking store, computes a structured diff (field-by-field for JSON,
 * section-by-section for text/markdown), saves the new snapshot, and returns
 * a structured {@link DiffResult}.
 */

import { peel } from '../index.js';
import { getSnapshot } from './change-tracking.js';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface DiffOptions {
  /** Compare against the last tracked snapshot (default behaviour). */
  last?: boolean;
  /** Only compare these dot-notation fields (for JSON responses only). */
  fields?: string[];
  /** Use browser rendering for the fetch. */
  render?: boolean;
  /** Per-request timeout in milliseconds (default: 30 000). */
  timeout?: number;
}

export interface DiffResult {
  url: string;
  /** Whether any changes were detected. */
  changed: boolean;
  /** ISO-8601 timestamp of the current fetch. */
  timestamp: string;
  /** ISO-8601 timestamp of the previous snapshot (undefined if none). */
  previousTimestamp?: string;
  changes: DiffChange[];
  /** Human-readable summary sentence. */
  summary: string;
}

export interface DiffChange {
  type: 'added' | 'removed' | 'modified';
  /** For JSON diffs: dot-notation path to the changed field. */
  field?: string;
  /** For text diffs: nearest section heading or line reference. */
  path?: string;
  before?: string;
  after?: string;
}

// ─── JSON diffing ──────────────────────────────────────────────────────────────

/**
 * Compare two JSON values recursively, returning structured {@link DiffChange}
 * objects.  Non-object values (numbers, strings, arrays) are reported as atomic
 * modifications.
 *
 * @param before   - Previous JSON value
 * @param after    - Current JSON value
 * @param path     - Current dot-notation path (for recursion; start with "")
 * @param fields   - Optional allowlist of dot-notation paths to compare
 */
function diffJson(
  before: unknown,
  after: unknown,
  path: string = '',
  fields?: string[],
): DiffChange[] {
  const changes: DiffChange[] = [];

  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

  if (!isPlainObject(before) || !isPlainObject(after)) {
    // Atomic comparison.
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      if (!fields || fields.length === 0 || fields.some(f => f === path || path.startsWith(f + '.'))) {
        changes.push({
          type: 'modified',
          field: path || '(root)',
          before: stringify(before),
          after: stringify(after),
        });
      }
    }
    return changes;
  }

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const fullPath = path ? `${path}.${key}` : key;

    // Apply field filter when specified.
    if (fields && fields.length > 0) {
      const inScope = fields.some(f =>
        fullPath === f || fullPath.startsWith(f + '.') || f.startsWith(fullPath + '.'),
      );
      if (!inScope) continue;
    }

    const bVal = before[key];
    const aVal = after[key];

    if (bVal === undefined && aVal !== undefined) {
      changes.push({ type: 'added', field: fullPath, after: stringify(aVal) });
    } else if (bVal !== undefined && aVal === undefined) {
      changes.push({ type: 'removed', field: fullPath, before: stringify(bVal) });
    } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      // Recurse into nested objects.
      if (isPlainObject(bVal) && isPlainObject(aVal)) {
        changes.push(...diffJson(bVal, aVal, fullPath, fields));
      } else {
        changes.push({
          type: 'modified',
          field: fullPath,
          before: stringify(bVal),
          after: stringify(aVal),
        });
      }
    }
  }

  return changes;
}

/** Serialize a JSON value concisely for display. */
function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v) ?? 'undefined';
}

// ─── Text / Markdown diffing ───────────────────────────────────────────────────

interface TextDiffStats {
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Diff two text blobs line-by-line using LCS (Longest Common Subsequence).
 * Groups consecutive additions/deletions into sections keyed by the nearest
 * Markdown heading.
 */
function diffText(beforeText: string, afterText: string): { changes: DiffChange[]; stats: TextDiffStats } {
  const MAX_LINES = 5_000;
  const bLines = beforeText.split('\n').slice(0, MAX_LINES);
  const aLines = afterText.split('\n').slice(0, MAX_LINES);

  // Build LCS table.
  const m = bLines.length;
  const n = aLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (bLines[i - 1] === aLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j]!, lcs[i][j - 1]!);
      }
    }
  }

  // Backtrack to produce an ordered edit sequence.
  type Op = { op: 'add' | 'del' | 'same'; line: string };
  const ops: Op[] = [];
  let bi = m;
  let ai = n;

  while (bi > 0 || ai > 0) {
    if (bi > 0 && ai > 0 && bLines[bi - 1] === aLines[ai - 1]) {
      ops.unshift({ op: 'same', line: aLines[ai - 1]! });
      bi--; ai--;
    } else if (ai > 0 && (bi === 0 || lcs[bi]![ai - 1]! >= lcs[bi - 1]![ai]!)) {
      ops.unshift({ op: 'add', line: aLines[ai - 1]! });
      ai--;
    } else {
      ops.unshift({ op: 'del', line: bLines[bi - 1]! });
      bi--;
    }
  }

  // Group consecutive non-same ops into sections.
  const changes: DiffChange[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  let i = 0;

  while (i < ops.length) {
    if (ops[i]!.op === 'same') { i++; continue; }

    // Collect the run of changes.
    const added: string[] = [];
    const removed: string[] = [];

    while (i < ops.length && ops[i]!.op !== 'same') {
      if (ops[i]!.op === 'add') added.push(ops[i]!.line);
      if (ops[i]!.op === 'del') removed.push(ops[i]!.line);
      i++;
    }

    linesAdded += added.length;
    linesRemoved += removed.length;

    // Find nearest Markdown heading in the 'same' lines before this block.
    let sectionLabel = `line ~${i}`;
    for (let k = i - added.length - removed.length - 1; k >= 0; k--) {
      const prevOp = ops[k];
      if (prevOp && prevOp.op === 'same' && /^#{1,6}\s/.test(prevOp.line)) {
        sectionLabel = prevOp.line.trim();
        break;
      }
    }

    if (removed.length > 0 && added.length > 0) {
      changes.push({ type: 'modified', path: sectionLabel, before: removed.join('\n'), after: added.join('\n') });
    } else if (added.length > 0) {
      changes.push({ type: 'added', path: sectionLabel, after: added.join('\n') });
    } else if (removed.length > 0) {
      changes.push({ type: 'removed', path: sectionLabel, before: removed.join('\n') });
    }
  }

  return { changes, stats: { linesAdded, linesRemoved } };
}

// ─── Summary generation ────────────────────────────────────────────────────────

function buildSummary(
  changes: DiffChange[],
  mode: 'json' | 'text',
  jsonTotalFields?: number,
  textStats?: TextDiffStats,
): string {
  if (changes.length === 0) return 'No changes detected.';

  if (mode === 'json') {
    const unchanged = Math.max(0, (jsonTotalFields ?? 0) - changes.length);
    const parts: string[] = [
      `${changes.length} field${changes.length === 1 ? '' : 's'} changed`,
    ];
    if (unchanged > 0) parts.push(`${unchanged} unchanged`);
    return parts.join(', ') + '.';
  }

  // Text mode.
  const sections = changes.length;
  const added = textStats?.linesAdded ?? 0;
  const removed = textStats?.linesRemoved ?? 0;
  return (
    `${sections} section${sections === 1 ? '' : 's'} changed` +
    (added > 0 ? `, ${added} lines added` : '') +
    (removed > 0 ? `, ${removed} removed` : '') +
    '.'
  );
}

// ─── Key counting helpers ──────────────────────────────────────────────────────

/** Count the total number of leaf-level keys (dot-notation) in two JSON objects combined. */
function countTotalFields(a: unknown, b: unknown): number {
  const keys = new Set<string>();
  collectKeys(a, '', keys);
  collectKeys(b, '', keys);
  return keys.size;
}

function collectKeys(obj: unknown, prefix: string, acc: Set<string>): void {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    if (prefix) acc.add(prefix);
    return;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    acc.add(path);
    collectKeys((obj as Record<string, unknown>)[key], path, acc);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and compute a semantic diff against the last tracked snapshot.
 *
 * The function:
 * 1. Loads the previous snapshot (if any) from the change-tracking store.
 * 2. Fetches the current content via {@link peel}.
 * 3. Saves the current content as the new snapshot (auto-tracking).
 * 4. Computes a structured diff — field-by-field for JSON, section-by-section
 *    for text/markdown.
 * 5. Returns a {@link DiffResult}.
 *
 * @example
 * ```typescript
 * const result = await diffUrl('https://api.example.com/health', { last: true });
 * console.log(result.summary);
 * result.changes.forEach(c => {
 *   if (c.field) console.log(`${c.type}: ${c.field}  ${c.before} → ${c.after}`);
 * });
 * ```
 */
export async function diffUrl(url: string, options: DiffOptions = {}): Promise<DiffResult> {
  const { fields, render = false, timeout = 30_000 } = options;

  // 1. Load previous snapshot before fetching (fetch overwrites it).
  const prevSnapshot = await getSnapshot(url);

  // 2. Fetch current content.  changeTracking: true auto-saves the new snapshot.
  const result = await peel(url, {
    render,
    timeout,
    format: 'markdown',
    changeTracking: true,
  });

  const now = new Date().toISOString();

  // 3. No baseline → return an informational result.
  if (!prevSnapshot) {
    return {
      url: result.url,
      changed: false,
      timestamp: now,
      changes: [],
      summary: 'No previous snapshot found. Current content saved as baseline.',
    };
  }

  const previousTimestamp = new Date(prevSnapshot.timestamp).toISOString();
  const previousContent = prevSnapshot.content;
  const currentContent = result.content;

  // 4. Detect content type and compute appropriate diff.
  let mode: 'json' | 'text' = 'text';
  let changes: DiffChange[] = [];
  let jsonTotalFields = 0;
  let textStats: TextDiffStats | undefined;

  let prevJson: unknown = null;
  let currJson: unknown = null;

  try {
    prevJson = JSON.parse(previousContent);
    currJson = JSON.parse(currentContent);
    mode = 'json';
  } catch {
    /* Not JSON — fall through to text diffing */
  }

  if (mode === 'json' && prevJson !== null && currJson !== null) {
    changes = diffJson(prevJson, currJson, '', fields);
    jsonTotalFields = countTotalFields(prevJson, currJson);
  } else {
    const { changes: textChanges, stats } = diffText(previousContent, currentContent);
    changes = textChanges;
    textStats = stats;
  }

  // 5. Handle edge case: content changed but we couldn't detect it (e.g. fingerprint
  //    mismatch recorded by peel, but diff shows no changes at field level).
  const changed = changes.length > 0;

  return {
    url: result.url,
    changed,
    timestamp: now,
    previousTimestamp,
    changes,
    summary: buildSummary(changes, mode, jsonTotalFields, textStats),
  };
}

// ─── Re-export trackChange for CLI convenience ─────────────────────────────────

export { trackChange, getSnapshot } from './change-tracking.js';
