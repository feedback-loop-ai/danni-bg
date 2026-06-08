// Pure helpers for charting tabular rows: detect numeric columns and project a (label, value) series
// for a simple bar chart. Kept out of the component so the logic is unit-tested.

import { cellText } from './table.ts';

export function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
  return false;
}

/** Columns whose present values are >=80% numeric (so a stray label doesn't disqualify them). */
export function numericColumns(rows: unknown[], columns: string[]): string[] {
  return columns.filter((col) => {
    let present = 0;
    let numeric = 0;
    for (const row of rows) {
      if (row && typeof row === 'object') {
        const v = (row as Record<string, unknown>)[col];
        if (v !== null && v !== undefined && v !== '') {
          present += 1;
          if (isNumeric(v)) numeric += 1;
        }
      }
    }
    return present > 0 && numeric / present >= 0.8;
  });
}

export interface BarPoint {
  label: string;
  value: number;
}

/** Build a bar series: `valueColumn` (numeric) by `labelColumn` (or row index when null), capped. */
export function toSeries(
  rows: unknown[],
  labelColumn: string | null,
  valueColumn: string,
  max = 30,
): { points: BarPoint[]; maxValue: number } {
  const points: BarPoint[] = [];
  for (const row of rows) {
    if (points.length >= max) break;
    const rec = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
    const raw = rec[valueColumn];
    if (!isNumeric(raw)) continue;
    const label = labelColumn ? cellText(rec[labelColumn]) : String(points.length + 1);
    points.push({ label, value: Number(raw) });
  }
  const maxValue = points.reduce((m, p) => Math.max(m, Math.abs(p.value)), 0);
  return { points, maxValue };
}
