// Pure helpers for rendering + exporting tabular resource rows (the data drilldown). Kept out of the
// component so they're unit-tested.

/** Union of object keys across the sampled rows, in first-seen order, capped at `max` columns. */
export function tableColumns(rows: unknown[], max = 12): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          cols.push(key);
          if (cols.length >= max) return cols;
        }
      }
    }
  }
  return cols;
}

/** Render a cell value as text (objects/arrays → compact JSON, null/undefined → empty). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Serialise rows to CSV over the given columns (RFC-4180 quoting). */
export function toCsv(rows: unknown[], columns: string[]): string {
  const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = columns.map(quote).join(',');
  const body = rows.map((row) => {
    const rec = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    return columns.map((c) => quote(cellText(rec[c]))).join(',');
  });
  return [header, ...body].join('\n');
}
