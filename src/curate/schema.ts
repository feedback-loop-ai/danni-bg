import { normalizeBoolean, normalizeDate, normalizeDecimal } from './normalize.ts';

export type ColumnType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json';

export interface ColumnInference {
  type: ColumnType;
  nullable: boolean;
  format?: string;
  confidence: number;
  alternates?: Array<{ type: ColumnType; format?: string; confidence: number }>;
}

const ID_RE = /^[a-z][a-z0-9_]*$/;

export function canonicalizeName(source: string, taken: Set<string>): string {
  const decomposed = source
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}_]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/__+/g, '_');
  let candidate =
    decomposed.length > 0 && /[a-z]/.test(decomposed[0] ?? '') ? decomposed : `c_${decomposed}`;
  if (!ID_RE.test(candidate)) {
    candidate = `c_${candidate.replace(/[^a-z0-9_]/g, '')}`;
  }
  let final = candidate;
  let n = 1;
  while (taken.has(final)) {
    final = `${candidate}_${n++}`;
  }
  taken.add(final);
  return final;
}

export function inferColumnType(values: Array<string | null>): ColumnInference {
  let nullable = false;
  let dates = 0;
  let datetimes = 0;
  let ints = 0;
  let decimals = 0;
  let bools = 0;
  let total = 0;
  for (const v of values) {
    if (v === null || v.trim() === '') {
      nullable = true;
      continue;
    }
    total++;
    const date = normalizeDate(v);
    if (date) {
      if (date.iso.length > 10 || /T/.test(v)) datetimes++;
      else dates++;
      continue;
    }
    const dec = normalizeDecimal(v);
    if (dec) {
      if (dec.rule === 'integer') ints++;
      else decimals++;
      continue;
    }
    if (normalizeBoolean(v) !== null) {
      bools++;
    }
  }
  if (total === 0) {
    return { type: 'string', nullable, confidence: 0.5 };
  }
  const choose = (count: number, type: ColumnType, fmt?: string): ColumnInference | null => {
    if (count >= total * 0.9) {
      const conf = count === total ? 0.95 : 0.8;
      return fmt
        ? { type, nullable, format: fmt, confidence: conf }
        : { type, nullable, confidence: conf };
    }
    return null;
  };
  return (
    choose(datetimes + dates, 'datetime', 'iso8601') ??
    choose(dates, 'date', 'iso8601') ??
    choose(ints, 'integer') ??
    choose(decimals + ints, 'decimal') ??
    choose(bools, 'boolean') ?? { type: 'string', nullable, confidence: 0.7 }
  );
}
