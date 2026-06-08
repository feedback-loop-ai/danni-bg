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

/** A value is date-like if it's a string with a date/time separator that Date.parse can read. */
export function isDateLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s === '' || !/[-/:T]/.test(s)) return false;
  return Number.isFinite(Date.parse(s));
}

/** Columns whose present values are >=80% date-like — candidates for a time-series x-axis. */
export function dateColumns(rows: unknown[], columns: string[]): string[] {
  return columns.filter((col) => {
    let present = 0;
    let dated = 0;
    for (const row of rows) {
      if (row && typeof row === 'object') {
        const v = (row as Record<string, unknown>)[col];
        if (v !== null && v !== undefined && v !== '') {
          present += 1;
          if (isDateLike(v)) dated += 1;
        }
      }
    }
    return present > 0 && dated / present >= 0.8;
  });
}

export interface BarPoint {
  label: string;
  value: number;
}

/** Sort points chronologically by their (date-like) label — used for the line/time-series view. */
export function orderByDate(points: BarPoint[]): BarPoint[] {
  return [...points].sort((a, b) => Date.parse(a.label) - Date.parse(b.label));
}

/** SVG polyline "x,y …" string mapping values across `width`, with 0 at the bottom of `height`. */
export function polylinePoints(
  values: number[],
  width: number,
  height: number,
  maxValue: number,
): string {
  if (values.length === 0 || maxValue <= 0) return '';
  return values
    .map((v, i) => {
      const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * width;
      const y = height - (Math.max(0, v) / maxValue) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
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
