const BG_LOWER = 'абвгдежзийклмнопрстуфхцчшщъьюяѣ';
const BG_UPPER = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯѢ';

export function isCyrillic(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (!(BG_LOWER.includes(ch) || BG_UPPER.includes(ch))) {
      return false;
    }
  }
  return true;
}

export function hasCyrillic(s: string): boolean {
  for (const ch of s) {
    if (BG_LOWER.includes(ch) || BG_UPPER.includes(ch)) {
      return true;
    }
  }
  return false;
}

const SLUG_PUNCT_RE = /[^a-z0-9а-яё]+/gi;

export function slugifyCyrillic(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(SLUG_PUNCT_RE, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeNfc(s: string): string {
  return s.normalize('NFC');
}
