/**
 * Standalone fixture generator for the XLSX curator tests.
 *
 * Run with:  bun run tests/fixtures/xlsx/build-fixtures.ts
 *
 * This script is intentionally NOT imported by any test — it pre-generates the
 * committed binary .xlsx fixtures that the test-suite reads. Keeping the ZIP
 * *writer* out of the test graph means (a) it never counts toward coverage and
 * (b) the curator's ZIP *reader* is validated against bytes produced here AND
 * against an independent golden file produced by LibreOffice (golden-soffice.xlsx).
 *
 * The writer below emits spec-faithful ZIP entries (correct CRC32, sizes) so the
 * fixtures open in real spreadsheet software too, plus a handful of deliberately
 * malformed archives used to exercise the reader's error branches.
 */
import { deflateRawSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// --- CRC32 (for genuinely-valid archives) ----------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry {
  name: string;
  data: Buffer;
  /** force a bogus compression method code in the headers (reader error path) */
  forceMethod?: number;
  /** store uncompressed (method 0) instead of deflate */
  store?: boolean;
}

interface ZipResult {
  buf: Buffer;
  cdOffset: number;
}

function zip(
  entries: Array<{ name: string; data: string | Buffer; forceMethod?: number; store?: boolean }>,
  opts: { comment?: Buffer } = {},
): ZipResult {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries as Entry[]) {
    const raw = typeof e.data === 'string' ? Buffer.from(e.data, 'utf-8') : e.data;
    const store = e.store === true;
    const body = store ? raw : deflateRawSync(raw);
    const method = e.forceMethod ?? (store ? 0 : 8);
    const nameBuf = Buffer.from(e.name, 'utf-8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const comment = opts.comment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return {
    buf: Buffer.concat([localBlock, centralBlock, eocd, comment]),
    cdOffset: localBlock.length,
  };
}

// --- SpreadsheetML helpers --------------------------------------------------
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type Cell =
  | { kind: 'empty' }
  | { kind: 's'; text: string } // shared string
  | { kind: 'n'; num: string } // number
  | { kind: 'b'; bool: boolean } // boolean
  | { kind: 'inline'; text: string } // inline string
  | { kind: 'str'; text: string }; // cached formula string

const COL = (i: number): string => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

interface Sheet {
  name: string;
  rows: Cell[][];
}

function buildWorkbook(sheets: Sheet[]): {
  workbook: string;
  rels: string;
  shared: string;
  worksheets: Array<{ part: string; xml: string }>;
} {
  const sharedTable: string[] = [];
  const sharedIndex = new Map<string, number>();
  const intern = (t: string): number => {
    const existing = sharedIndex.get(t);
    if (existing !== undefined) return existing;
    const idx = sharedTable.length;
    sharedTable.push(t);
    sharedIndex.set(t, idx);
    return idx;
  };

  const worksheets = sheets.map((sheet, si) => {
    const rowsXml = sheet.rows
      .map((row, ri) => {
        const cellsXml = row
          .map((cell, ci) => {
            const ref = `${COL(ci)}${ri + 1}`;
            switch (cell.kind) {
              case 'empty':
                return '';
              case 's':
                return `<c r="${ref}" t="s"><v>${intern(cell.text)}</v></c>`;
              case 'n':
                return `<c r="${ref}"><v>${cell.num}</v></c>`;
              case 'b':
                return `<c r="${ref}" t="b"><v>${cell.bool ? 1 : 0}</v></c>`;
              case 'inline':
                return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.text)}</t></is></c>`;
              case 'str':
                return `<c r="${ref}" t="str"><v>${esc(cell.text)}</v></c>`;
            }
          })
          .join('');
        return `<row r="${ri + 1}">${cellsXml}</row>`;
      })
      .join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${MAIN}"><sheetData>${rowsXml}</sheetData></worksheet>`;
    return { part: `xl/worksheets/sheet${si + 1}.xml`, xml };
  });

  const sheetTags = sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${sheetTags}</sheets></workbook>`;

  const relTags = sheets
    .map(
      (_s, i) =>
        `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('');
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relTags}</Relationships>`;

  const siTags = sharedTable.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('');
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${MAIN}" count="${sharedTable.length}" uniqueCount="${sharedTable.length}">${siTags}</sst>`;

  return { workbook, rels, shared, worksheets };
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function xlsxEntries(sheets: Sheet[], opts: { includeShared?: boolean } = {}) {
  const { workbook, rels, shared, worksheets } = buildWorkbook(sheets);
  const entries: Array<{ name: string; data: string; store?: boolean }> = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
  ];
  if (opts.includeShared !== false) entries.push({ name: 'xl/sharedStrings.xml', data: shared });
  for (const ws of worksheets) entries.push({ name: ws.part, data: ws.xml });
  return entries;
}

function write(name: string, buf: Buffer): void {
  writeFileSync(fileURLToPath(new URL(name, import.meta.url)), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}

// === simple.xlsx — one sheet, shared strings, mixed types, sparse cell ======
{
  const sheet: Sheet = {
    name: 'Данни',
    rows: [
      [
        { kind: 's', text: 'name' },
        { kind: 's', text: 'age' },
        { kind: 's', text: 'active' },
        { kind: 's', text: 'ts' },
      ],
      [
        { kind: 's', text: 'Ivan' },
        { kind: 'n', num: '30' },
        { kind: 'b', bool: true },
        { kind: 's', text: '2025-01-15' },
      ],
      [
        { kind: 's', text: 'Мария' },
        { kind: 'n', num: '25' },
        { kind: 'b', bool: false },
        { kind: 's', text: '2025-02-20' },
      ],
      [
        { kind: 's', text: 'Boyko' },
        { kind: 'empty' }, // sparse: age omitted
        { kind: 'b', bool: true },
        { kind: 's', text: '2025-03-01' },
      ],
    ],
  };
  write('simple.xlsx', zip(xlsxEntries([sheet])).buf);
}

// === multi-sheet.xlsx — 3 sheets incl. duplicate slug + empty sheet =========
{
  const a: Sheet = {
    name: 'Лист',
    rows: [
      [
        { kind: 's', text: 'city' },
        { kind: 's', text: 'pop' },
      ],
      [
        { kind: 's', text: 'Sofia' },
        { kind: 'n', num: '1200000' },
      ],
    ],
  };
  const b: Sheet = {
    // slugifies to the same base as `a` → exercises dedup
    name: 'Лист!!!',
    rows: [
      [
        { kind: 's', text: 'region' },
        { kind: 's', text: 'code' },
      ],
      [
        { kind: 's', text: 'Plovdiv' },
        { kind: 'str', text: 'BG-16' },
      ],
    ],
  };
  const empty: Sheet = { name: 'Empty', rows: [] };
  write('multi-sheet.xlsx', zip(xlsxEntries([a, b, empty])).buf);
}

// === inline-strings.xlsx — no sharedStrings part; inlineStr + formula str ====
{
  const sheet: Sheet = {
    name: 'Inline',
    rows: [
      [
        { kind: 'inline', text: 'label' },
        { kind: 'inline', text: 'amount' },
      ],
      [
        { kind: 'inline', text: 'Tom & Jerry <3' },
        { kind: 'str', text: '42' },
      ],
    ],
  };
  write('inline-strings.xlsx', zip(xlsxEntries([sheet], { includeShared: false })).buf);
}

// === stored.xlsx — workbook parts stored (method 0, uncompressed) ===========
{
  const sheet: Sheet = {
    name: 'Stored',
    rows: [[{ kind: 's', text: 'k' }], [{ kind: 's', text: 'v1' }], [{ kind: 's', text: 'v2' }]],
  };
  const entries = xlsxEntries([sheet]).map((e) => ({ ...e, store: true }));
  write('stored.xlsx', zip(entries).buf);
}

// === header-only.xlsx — header row, zero data rows ==========================
{
  const sheet: Sheet = {
    name: 'HeaderOnly',
    rows: [
      [
        { kind: 's', text: 'a' },
        { kind: 's', text: 'b' },
      ],
    ],
  };
  write('header-only.xlsx', zip(xlsxEntries([sheet])).buf);
}

// === empty-sheet-only.xlsx — single sheet, no rows (no curatable sheet) =====
{
  write('empty-sheet-only.xlsx', zip(xlsxEntries([{ name: 'Blank', rows: [] }])).buf);
}

// === missing-part.xlsx — sheet 2's worksheet part omitted (skip branch) =====
{
  const a: Sheet = {
    name: 'Present',
    rows: [[{ kind: 's', text: 'x' }], [{ kind: 's', text: '1' }]],
  };
  const b: Sheet = { name: 'Ghost', rows: [[{ kind: 's', text: 'y' }]] };
  const entries = xlsxEntries([a, b]).filter((e) => e.name !== 'xl/worksheets/sheet2.xml');
  write('missing-part.xlsx', zip(entries).buf);
}

// === eocd-comment-trap.xlsx — a ≥22-byte archive comment that itself begins
//     with the EOCD signature, placed so the backward scan meets it before the
//     real record. The reader must validate the comment-length invariant and
//     keep scanning to the true EOCD. ==========================================
{
  const sheet: Sheet = {
    name: 'Trap',
    rows: [[{ kind: 's', text: 'k' }], [{ kind: 's', text: 'ok' }]],
  };
  const comment = Buffer.alloc(30);
  comment.writeUInt32LE(0x06054b50, 0); // decoy EOCD signature at comment start
  write('eocd-comment-trap.xlsx', zip(xlsxEntries([sheet]), { comment }).buf);
}

// === no-workbook.bin — valid zip, but no xl/workbook.xml ====================
{
  write('no-workbook.bin', zip([{ name: 'hello.txt', data: 'not a workbook' }]).buf);
}

// === unsupported-method.xlsx — bogus compression method code ================
{
  write(
    'unsupported-method.xlsx',
    zip([{ name: 'xl/workbook.xml', data: 'x', forceMethod: 99, store: true }]).buf,
  );
}

// === bad-central.bin / bad-local.bin — corrupted signatures =================
{
  const { buf, cdOffset } = zip([{ name: 'a.txt', data: 'hi' }]);
  const badLocal = Buffer.from(buf);
  badLocal.writeUInt32LE(0xdeadbeef, 0);
  write('bad-local.bin', badLocal);

  const badCentral = Buffer.from(buf);
  badCentral.writeUInt32LE(0xdeadbeef, cdOffset);
  write('bad-central.bin', badCentral);
}

console.log('done');
