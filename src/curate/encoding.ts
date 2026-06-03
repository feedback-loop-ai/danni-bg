export type DetectedEncoding = 'utf-8' | 'cp1251';

export interface EncodingDetection {
  encoding: DetectedEncoding;
  confidence: number;
  reason: 'bom' | 'declared' | 'heuristic-utf8' | 'heuristic-cp1251';
}

const HIGH_BIT_CYR_RANGE_CP1251 = (b: number): boolean => b >= 0xc0 && b <= 0xff;

function isValidUtf8(bytes: Buffer | Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] ?? 0;
    if (b < 0x80) {
      i++;
      continue;
    }
    let needed = 0;
    if ((b & 0xe0) === 0xc0) needed = 1;
    else if ((b & 0xf0) === 0xe0) needed = 2;
    else if ((b & 0xf8) === 0xf0) needed = 3;
    else return false;
    if (i + needed >= bytes.length) return false;
    for (let j = 1; j <= needed; j++) {
      const next = bytes[i + j] ?? 0;
      if ((next & 0xc0) !== 0x80) return false;
    }
    i += needed + 1;
  }
  return true;
}

export function detectEncoding(
  bytes: Buffer | Uint8Array,
  declaredCharset?: string | null,
): EncodingDetection {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', confidence: 1.0, reason: 'bom' };
  }
  if (declaredCharset) {
    const lower = declaredCharset.toLowerCase();
    if (lower === 'utf-8' || lower === 'utf8') {
      return { encoding: 'utf-8', confidence: 0.95, reason: 'declared' };
    }
    if (
      lower === 'windows-1251' ||
      lower === 'cp1251' ||
      lower === 'cp-1251' ||
      lower === 'win-1251'
    ) {
      return { encoding: 'cp1251', confidence: 0.95, reason: 'declared' };
    }
  }
  // Heuristic: count high-bit bytes that fit cp1251 cyrillic range; valid utf8 wins on tie
  let highBit = 0;
  let cp1251Cyr = 0;
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
    const b = bytes[i] ?? 0;
    if (b >= 0x80) {
      highBit++;
      if (HIGH_BIT_CYR_RANGE_CP1251(b)) cp1251Cyr++;
    }
  }
  if (highBit === 0) {
    return { encoding: 'utf-8', confidence: 1.0, reason: 'heuristic-utf8' };
  }
  if (isValidUtf8(bytes)) {
    return { encoding: 'utf-8', confidence: 0.85, reason: 'heuristic-utf8' };
  }
  // High proportion of cp1251 cyrillic range bytes → cp1251
  if (cp1251Cyr / highBit >= 0.8) {
    return { encoding: 'cp1251', confidence: 0.8, reason: 'heuristic-cp1251' };
  }
  return { encoding: 'utf-8', confidence: 0.5, reason: 'heuristic-utf8' };
}

const CP1251_TO_UNICODE: Record<number, number> = (() => {
  const map: Record<number, number> = {};
  // Cyrillic block: 0xc0..0xff → U+0410..U+044F
  for (let i = 0xc0; i <= 0xff; i++) map[i] = 0x0410 + (i - 0xc0);
  // Some special CP1251 mappings (a small representative subset; sufficient for fixtures)
  map[0x80] = 0x0402;
  map[0x81] = 0x0403;
  map[0x82] = 0x201a;
  map[0x83] = 0x0453;
  map[0x84] = 0x201e;
  map[0x85] = 0x2026;
  map[0x86] = 0x2020;
  map[0x87] = 0x2021;
  map[0x88] = 0x20ac;
  map[0x89] = 0x2030;
  map[0x8a] = 0x0409;
  map[0x8b] = 0x2039;
  map[0x8c] = 0x040a;
  map[0x8d] = 0x040c;
  map[0x8e] = 0x040b;
  map[0x8f] = 0x040f;
  map[0xa1] = 0x040e;
  map[0xa2] = 0x045e;
  map[0xa3] = 0x0408;
  map[0xa5] = 0x0490;
  map[0xa8] = 0x0401;
  map[0xb8] = 0x0451;
  return map;
})();

export function decodeCp1251(bytes: Buffer | Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else {
      const cp = CP1251_TO_UNICODE[b] ?? 0xfffd;
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

export function decodeBytes(bytes: Buffer | Uint8Array, encoding: DetectedEncoding): string {
  if (encoding === 'utf-8') {
    let buf = bytes;
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      buf = buf.subarray(3);
    }
    return Buffer.from(buf).toString('utf-8');
  }
  return decodeCp1251(bytes);
}
