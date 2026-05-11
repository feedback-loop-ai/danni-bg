// Normalizers for curated tabular data: dates and decimals.

const BG_MONTHS: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};

export interface DateNormalization {
  iso: string;
  rule: 'iso8601' | 'bg-month-name' | 'dmy';
}

export function normalizeDate(input: string): DateNormalization | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // ISO-8601 (date or date-time)
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:T.+)?$/.exec(trimmed);
  if (isoMatch) {
    return { iso: trimmed.slice(0, 10), rule: 'iso8601' };
  }
  // dd.mm.yyyy or dd/mm/yyyy
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    const dd = String(Number.parseInt(dmy[1], 10)).padStart(2, '0');
    const mm = String(Number.parseInt(dmy[2], 10)).padStart(2, '0');
    return { iso: `${dmy[3]}-${mm}-${dd}`, rule: 'dmy' };
  }
  // Bulgarian month: "5 май 2025"
  const bg = /^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})$/u.exec(trimmed.toLowerCase());
  if (bg?.[1] && bg[2] && bg[3]) {
    const m = BG_MONTHS[bg[2]];
    if (m) {
      const dd = String(Number.parseInt(bg[1], 10)).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      return { iso: `${bg[3]}-${mm}-${dd}`, rule: 'bg-month-name' };
    }
  }
  return null;
}

export interface DecimalNormalization {
  value: number;
  rule: 'decimal-comma-to-point' | 'decimal-point' | 'integer';
}

export function normalizeDecimal(input: string): DecimalNormalization | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // 1 234,56 (BG locale) or 1.234,56 (also BG/EU)
  const bgLike = /^-?\d{1,3}(?:[\s. ]\d{3})*(?:,\d+)?$/.exec(trimmed);
  if (bgLike) {
    const cleaned = trimmed.replace(/[\s. ]/g, '').replace(',', '.');
    const v = Number.parseFloat(cleaned);
    if (Number.isFinite(v)) {
      return {
        value: v,
        rule: trimmed.includes(',') ? 'decimal-comma-to-point' : 'integer',
      };
    }
  }
  // 1234.56 (US locale) or plain integers
  const usLike = /^-?\d+(?:\.\d+)?$/.exec(trimmed);
  if (usLike) {
    const v = Number.parseFloat(trimmed);
    if (Number.isFinite(v)) {
      return { value: v, rule: trimmed.includes('.') ? 'decimal-point' : 'integer' };
    }
  }
  return null;
}

export function normalizeBoolean(input: string): boolean | null {
  const t = input.trim().toLowerCase();
  if (t === 'true' || t === 'да' || t === 'yes' || t === '1' || t === 'y') return true;
  if (t === 'false' || t === 'не' || t === 'no' || t === '0' || t === 'n') return false;
  return null;
}
