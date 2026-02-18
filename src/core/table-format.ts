/**
 * ASCII table renderer using Unicode box-drawing characters.
 *
 * Renders an array of objects (e.g. {@link ListingItem}) as a neatly formatted
 * table with auto-sized columns.
 *
 * @module table-format
 */

/* ------------------------------------------------------------------ */
/*  Box-drawing character set                                         */
/* ------------------------------------------------------------------ */

const BOX = {
  topLeft:     '┌',
  topRight:    '┐',
  bottomLeft:  '└',
  bottomRight: '┘',
  horizontal:  '─',
  vertical:    '│',
  teeDown:     '┬',
  teeUp:       '┴',
  teeRight:    '├',
  teeLeft:     '┤',
  cross:       '┼',
} as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const MAX_COL_WIDTH = 40;
const MIN_COL_WIDTH = 3;

/**
 * Truncate a string to `max` visible characters. Adds `…` if truncated.
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Pad (right) a string to `width` characters.
 */
function padRight(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + ' '.repeat(width - s.length);
}

/**
 * Capitalise the first letter of a string.
 */
function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Render an array of row objects as a Unicode box-drawing table.
 *
 * Column order follows the insertion order of keys in the first row.
 * Columns with exclusively `undefined`/empty values are omitted.
 *
 * @param rows    - Array of plain objects.
 * @param columns - Optional explicit column keys to include (in order).
 * @returns       Multi-line string ready for `console.log`.
 *
 * @example
 * ```typescript
 * import { formatTable } from './table-format.js';
 *
 * const table = formatTable([
 *   { title: 'Widget A', price: '$10' },
 *   { title: 'Widget B', price: '$20' },
 * ]);
 * console.log(table);
 * ```
 */
export function formatTable(
  rows: Record<string, string | undefined>[],
  columns?: string[],
): string {
  if (rows.length === 0) return '';

  // Determine columns: explicit list or derive from all rows
  const cols = columns ?? deriveColumns(rows);
  if (cols.length === 0) return '';

  // Build header labels
  const headers = cols.map(c => capitalise(c));

  // Compute column widths (bounded by MIN/MAX)
  const widths = cols.map((col, i) => {
    let max = headers[i].length;
    for (const row of rows) {
      const val = row[col] ?? '';
      if (val.length > max) max = val.length;
    }
    return Math.max(MIN_COL_WIDTH, Math.min(max, MAX_COL_WIDTH));
  });

  // Build lines
  const lines: string[] = [];

  // Top border
  lines.push(
    BOX.topLeft +
    widths.map(w => BOX.horizontal.repeat(w + 2)).join(BOX.teeDown) +
    BOX.topRight,
  );

  // Header row
  lines.push(
    BOX.vertical +
    headers.map((h, i) => ' ' + padRight(truncate(h, widths[i]), widths[i]) + ' ').join(BOX.vertical) +
    BOX.vertical,
  );

  // Separator
  lines.push(
    BOX.teeRight +
    widths.map(w => BOX.horizontal.repeat(w + 2)).join(BOX.cross) +
    BOX.teeLeft,
  );

  // Data rows
  for (const row of rows) {
    lines.push(
      BOX.vertical +
      cols.map((col, i) => {
        const val = row[col] ?? '';
        return ' ' + padRight(truncate(val, widths[i]), widths[i]) + ' ';
      }).join(BOX.vertical) +
      BOX.vertical,
    );
  }

  // Bottom border
  lines.push(
    BOX.bottomLeft +
    widths.map(w => BOX.horizontal.repeat(w + 2)).join(BOX.teeUp) +
    BOX.bottomRight,
  );

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Internals                                                         */
/* ------------------------------------------------------------------ */

/**
 * Derive the set of columns that have at least one non-empty value across
 * all rows. Preserves insertion order from the first row that provides a key.
 */
function deriveColumns(rows: Record<string, string | undefined>[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }

  // Filter out columns that are entirely empty
  return order.filter(col => rows.some(r => r[col] && r[col]!.trim().length > 0));
}
