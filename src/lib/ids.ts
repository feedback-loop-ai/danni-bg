const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const ENCODING_LEN = CROCKFORD_BASE32.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error(`ulid: invalid time ${now}`);
  }
  let mod: number;
  let str = '';
  let value = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    mod = value % ENCODING_LEN;
    str = CROCKFORD_BASE32.charAt(mod) + str;
    value = (value - mod) / ENCODING_LEN;
  }
  return str;
}

function encodeRandom(rand: () => number): string {
  let str = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    const r = Math.floor(rand() * ENCODING_LEN);
    str += CROCKFORD_BASE32.charAt(r);
  }
  return str;
}

export interface UlidOptions {
  now?: number;
  random?: () => number;
}

export function ulid(options: UlidOptions = {}): string {
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  return encodeTime(now) + encodeRandom(random);
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(s: string): boolean {
  return ULID_RE.test(s);
}
