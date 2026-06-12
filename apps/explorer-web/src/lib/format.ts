// Pure display helpers (T031). Bilingual label fallback, freshness rendering, and machine-translation
// labelling. Authoritative Bulgarian text is shown verbatim; English/derived text is flagged when the
// translation confidence is low so users do not over-trust it (FR-031, Constitution X).

import type { FreshnessBlock, Lang } from '../types.ts';

/** Prefer the requested language; fall back to Bulgarian (always present) when English is absent. */
export function bilingualLabel(bg: string, en: string | null, lang: Lang): string {
  if (lang === 'en') return en ?? bg;
  return bg;
}

/** A short note when text is machine-translated with low confidence (null when not applicable). */
export function translationNote(translationConfidence: number | null, lang: Lang): string | null {
  if (lang !== 'en' || translationConfidence === null) return null;
  return translationConfidence < 0.7 ? 'машинен превод (ниска увереност)' : null;
}

export interface FreshnessDisplay {
  label: string;
  isStale: boolean;
}

export function freshnessDisplay(f: FreshnessBlock): FreshnessDisplay {
  const date = f.lastSyncedAt.slice(0, 10);
  return {
    label: f.isStale ? `остаряло · последно ${date}` : `актуално · ${date}`,
    isStale: f.isStale,
  };
}
