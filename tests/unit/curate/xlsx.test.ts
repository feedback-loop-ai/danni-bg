import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CurateContext } from '../../../src/curate/curator.ts';
import {
  XlsxCurator,
  parseSharedStrings,
  parseWorkbookSheets,
  parseWorksheet,
  parseXlsx,
  resolveTarget,
  unzipXlsx,
} from '../../../src/curate/xlsx.ts';
import type { ResourceRow } from '../../../src/store/repos/resources.ts';

const FIX = fileURLToPath(new URL('../../fixtures/xlsx/', import.meta.url));

function fixture(name: string): Buffer {
  return readFileSync(join(FIX, name));
}

function fakeResource(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'r1',
    dataset_id: 'd1',
    position: 0,
    name: 'r1',
    description_bg: null,
    declared_format: 'xlsx',
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1.xlsx',
    bytes: null,
    sha256: null,
    raw_path: null,
    etag: null,
    last_modified: null,
    first_seen_at: '2026-05-08T00:00:00Z',
    last_synced_at: '2026-05-08T00:00:00Z',
    last_outcome: 'success',
    last_failure_reason: null,
    lifecycle_state: 'active',
    ...overrides,
  };
}

function ctxFor(name: string, overrides: Partial<ResourceRow> = {}): CurateContext {
  return {
    storeRoot: globalThis.__TEST_TMP_DIR__,
    resource: fakeResource(overrides),
    rawAbsPath: join(FIX, name),
    curatorVersion: 'test',
  };
}

function readNdjson(slug: string): Array<Record<string, unknown>> {
  const root = globalThis.__TEST_TMP_DIR__;
  const text = readFileSync(join(root, 'curated', 'd1', 'r1', slug, 'data.ndjson'), 'utf-8');
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('curate.xlsx (curator)', () => {
  it('curates a single sheet with shared strings, mixed types, and a sparse cell', async () => {
    const out = await new XlsxCurator().curate(ctxFor('simple.xlsx'));
    expect(out.kind).toBe('tabular');
    // Cyrillic sheet name "Данни" → slug "данни"
    expect(out.path).toBe(join('d1', 'r1', 'данни', 'data.ndjson'));
    const root = globalThis.__TEST_TMP_DIR__;
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'данни', 'data.ndjson'))).toBe(true);
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'данни', 'schema.json'))).toBe(true);

    if (out.schema.kind !== 'tabular') throw new Error('expected tabular schema');
    const byName = Object.fromEntries(out.schema.columns.map((c) => [c.canonicalName, c]));
    expect(out.schema.columns.map((c) => c.canonicalName)).toEqual(['name', 'age', 'active', 'ts']);
    expect(byName.age?.type).toBe('integer');
    expect(byName.active?.type).toBe('boolean');
    // inferColumnType labels ISO date-only columns 'datetime' (shared with the CSV curator)
    expect(byName.ts?.type).toBe('datetime');
    expect(out.schema.rowCount).toBe(3);

    const rows = readNdjson('данни');
    expect(rows[0]).toEqual({ name: 'Ivan', age: 30, active: true, ts: '2025-01-15' });
    expect(rows[1]).toEqual({ name: 'Мария', age: 25, active: false, ts: '2025-02-20' });
    // sparse: age omitted in source → null
    expect(rows[2]).toEqual({ name: 'Boyko', age: null, active: true, ts: '2025-03-01' });
  });

  it('emits one artifact per sheet, skips empty sheets, dedups colliding slugs', async () => {
    const out = await new XlsxCurator().curate(ctxFor('multi-sheet.xlsx'));
    const root = globalThis.__TEST_TMP_DIR__;
    // "Лист" → "лист"; "Лист!!!" → "лист" → deduped "лист-1"; "Empty" skipped (no rows)
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'лист', 'data.ndjson'))).toBe(true);
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'лист-1', 'data.ndjson'))).toBe(true);

    const wb = out.transformRules.find((r) => r.rule === 'xlsx-workbook');
    expect(wb).toBeDefined();
    const sheets = (wb?.params?.sheets ?? []) as Array<{ slug: string; rowCount: number }>;
    expect(sheets.map((s) => s.slug)).toEqual(['лист', 'лист-1']);
    expect(out.transformRules.some((r) => r.rule === 'xlsx-unzip')).toBe(true);
    expect(out.path).toBe(join('d1', 'r1', 'лист', 'data.ndjson'));
  });

  it('handles inline strings and cached formula strings (no sharedStrings part)', async () => {
    const out = await new XlsxCurator().curate(ctxFor('inline-strings.xlsx'));
    expect(out.kind).toBe('tabular');
    const rows = readNdjson('inline');
    expect(rows[0]?.label).toBe('Tom & Jerry <3');
    expect(rows[0]?.amount).toBe(42);
  });

  it('reads stored (uncompressed, method 0) zip entries', async () => {
    const out = await new XlsxCurator().curate(ctxFor('stored.xlsx'));
    expect(out.kind).toBe('tabular');
    const rows = readNdjson('stored');
    expect(rows.map((r) => r.k)).toEqual(['v1', 'v2']);
  });

  it('curates a header-only sheet to a zero-row artifact', async () => {
    const out = await new XlsxCurator().curate(ctxFor('header-only.xlsx'));
    if (out.schema.kind !== 'tabular') throw new Error('expected tabular schema');
    expect(out.schema.rowCount).toBe(0);
    expect(out.schema.columns.length).toBe(2);
    expect(readNdjson('headeronly')).toEqual([]);
  });

  it('parses a genuine LibreOffice-produced workbook', async () => {
    const out = await new XlsxCurator().curate(ctxFor('golden-soffice.xlsx'));
    if (out.schema.kind !== 'tabular') throw new Error('expected tabular schema');
    expect(out.schema.columns.map((c) => c.canonicalName)).toEqual(['name', 'age', 'city']);
    expect(out.schema.columns.find((c) => c.canonicalName === 'age')?.type).toBe('integer');
    expect(out.schema.rowCount).toBe(3);
    const rows = readNdjson('golden');
    expect(rows[0]).toEqual({ name: 'Ivan', age: 30, city: 'Sofia' });
  });

  it('skips sheets whose worksheet part is missing', async () => {
    const out = await new XlsxCurator().curate(ctxFor('missing-part.xlsx'));
    const wb = out.transformRules.find((r) => r.rule === 'xlsx-workbook');
    const sheets = (wb?.params?.sheets ?? []) as Array<{ slug: string }>;
    expect(sheets.map((s) => s.slug)).toEqual(['present']);
  });

  it('throws when the workbook has no curatable sheets', async () => {
    await expect(new XlsxCurator().curate(ctxFor('empty-sheet-only.xlsx'))).rejects.toThrow(
      /no curatable sheets/,
    );
  });
});

describe('curate.xlsx (canHandle)', () => {
  const c = new XlsxCurator();

  it('matches declared xlsx format', () => {
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: 'xlsx' }),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(true);
  });

  it('matches an .xlsx URL without declared format', () => {
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: null, source_url: 'https://x/report.XLSX' }),
        rawAbsPath: '',
        curatorVersion: 'v',
      }),
    ).toBe(true);
  });

  it('matches by magic bytes when format/url are misleading', () => {
    expect(
      c.canHandle(
        ctxFor('simple.xlsx', { declared_format: 'csv', source_url: 'https://x/wrong.csv' }),
      ),
    ).toBe(true);
  });

  it('rejects a non-xlsx resource', () => {
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: 'csv', source_url: 'https://x/file.csv' }),
        rawAbsPath: join(FIX, 'no-workbook.bin'),
        curatorVersion: 'v',
      }),
    ).toBe(false);
  });

  it('rejects when the raw file is unreadable', () => {
    expect(
      c.canHandle({
        storeRoot: '',
        resource: fakeResource({ declared_format: 'csv', source_url: 'https://x/file.csv' }),
        rawAbsPath: join(FIX, 'does-not-exist.xlsx'),
        curatorVersion: 'v',
      }),
    ).toBe(false);
  });
});

describe('curate.xlsx (zip + xml internals)', () => {
  it('throws when the EOCD record is absent (not a zip)', () => {
    expect(() => unzipXlsx(Buffer.from('definitely not a zip archive'))).toThrow(
      /end-of-central-directory/,
    );
  });

  it('throws on an unsupported compression method', () => {
    expect(() => unzipXlsx(fixture('unsupported-method.xlsx'))).toThrow(/unsupported compression/);
  });

  it('throws on a corrupted central-directory signature', () => {
    expect(() => unzipXlsx(fixture('bad-central.bin'))).toThrow(/central-directory signature/);
  });

  it('throws on a corrupted local-header signature', () => {
    expect(() => unzipXlsx(fixture('bad-local.bin'))).toThrow(/local-header signature/);
  });

  it('throws when xl/workbook.xml is absent', () => {
    expect(() => parseXlsx(fixture('no-workbook.bin'))).toThrow(/workbook\.xml not found/);
  });

  it('decodes named, decimal, and hex XML entities in shared strings', () => {
    const xml =
      '<sst><si><t>a &amp; b &lt;x&gt; &#65;&#x42;</t></si><si/><si><r><t>foo</t></r><r><t>bar</t></r></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['a & b <x> AB', '', 'foobar']);
  });

  it('resolves cell references, auto-increments ref-less cells, and covers every cell type', () => {
    const shared = ['Alpha', 'Beta'];
    const xml =
      '<worksheet><sheetData>' +
      // ref-less cells auto-increment by position
      '<row r="1"><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>' +
      // shared (resolved + out-of-range), number, inline, formula-str, bool variants, error, empty
      '<row r="2">' +
      '<c r="A2" t="s"><v>0</v></c>' +
      '<c r="B2" t="s"><v>9</v></c>' +
      '<c r="C2"><v>3.5</v></c>' +
      '<c r="D2" t="inlineStr"><is><t>inl</t></is></c>' +
      '<c r="E2" t="str"><v>fx</v></c>' +
      '<c r="F2" t="b"><v>1</v></c>' +
      '<c r="G2" t="b"><v>0</v></c>' +
      '<c r="H2" t="b"><v>x</v></c>' +
      '<c r="I2" t="e"><v>#DIV/0!</v></c>' +
      '<c r="J2"/>' +
      // a cell with no <v> and no inlineStr → collectText fallback
      '<c r="K2"><is><t>fb</t></is></c>' +
      // a t="s" with a non-integer index → empty
      '<c r="L2" t="s"><v>NaN</v></c>' +
      '</row>' +
      '</sheetData></worksheet>';
    const rows = parseWorksheet(xml, shared);
    expect(rows[0]).toEqual(['Alpha', 'Beta']);
    expect(rows[1]).toEqual([
      'Alpha', // A2 shared[0]
      '', // B2 shared[9] out of range
      '3.5', // C2 number
      'inl', // D2 inline
      'fx', // E2 formula str
      'true', // F2 bool 1
      'false', // G2 bool 0
      'x', // H2 bool non-0/1 → raw v
      '#DIV/0!', // I2 error → raw v
      '', // J2 self-closing empty
      'fb', // K2 collectText fallback
      '', // L2 non-integer shared index
    ]);
  });

  it('treats a self-closing empty row as an empty row', () => {
    const rows = parseWorksheet('<worksheet><sheetData><row r="1"/></sheetData></worksheet>', []);
    expect(rows).toEqual([[]]);
  });

  it('does not let a self-closing <t/> run swallow following markup (rich strings)', () => {
    // An empty formatting run emits <t/>; the value must still be just "Total".
    expect(
      parseSharedStrings('<sst><si><r><rPr><b/></rPr><t/></r><r><t>Total</t></r></si></sst>'),
    ).toEqual(['Total']);
    // Same hazard inside an inlineStr cell.
    const rows = parseWorksheet(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t/></r><r><t>Real</t></r></is></c></row></sheetData></worksheet>',
      [],
    );
    expect(rows[0]).toEqual(['Real']);
  });

  it('excludes phonetic <rPh> guide text from shared-string values', () => {
    expect(
      parseSharedStrings(
        '<sst><si><r><t>Kanji</t></r><rPh sb="0" eb="2"><t>かんじ</t></rPh></si></sst>',
      ),
    ).toEqual(['Kanji']);
  });

  it('preserves xml:space and adjacent runs while rejecting self-closing <t/>', () => {
    expect(parseSharedStrings('<sst><si><t xml:space="preserve">  x  </t></si></sst>')).toEqual([
      '  x  ',
    ]);
    expect(parseSharedStrings('<sst><si><r><t>a</t></r><r><t>b</t></r></si></sst>')).toEqual([
      'ab',
    ]);
  });

  it('finds the true EOCD past a trailing comment that embeds the EOCD signature', () => {
    const { sheets } = parseXlsx(fixture('eocd-comment-trap.xlsx'));
    expect(sheets[0]?.name).toBe('Trap');
    expect(sheets[0]?.rows).toEqual([['k'], ['ok']]);
  });

  it('handles a letter-less cell ref and a boolean cell with no <v>', () => {
    const rows = parseWorksheet(
      '<worksheet><sheetData><row r="1"><c r="1" t="s"><v>0</v></c><c r="B1" t="b"></c></row></sheetData></worksheet>',
      ['Alpha'],
    );
    // ref "1" has no column letters (columnIndex -1) → placed at the running
    // auto column 0; the value-less boolean yields ''.
    expect(rows[0]).toEqual(['Alpha', '']);
  });

  it('reads the uppercase r:ID relationship attribute', () => {
    const sheets = parseWorkbookSheets(
      '<workbook><sheets><sheet name="S" sheetId="1" r:ID="rId7"/></sheets></workbook>',
    );
    expect(sheets).toEqual([{ name: 'S', rId: 'rId7' }]);
  });

  it('resolves absolute and relative relationship targets', () => {
    expect(resolveTarget('/xl/worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
    expect(resolveTarget('./worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml');
    expect(resolveTarget('worksheets/sheet2.xml')).toBe('xl/worksheets/sheet2.xml');
  });
});

describe('curate.xlsx (re-curation cleanup)', () => {
  it('removes stale per-sheet directories when sheets change on re-curate', async () => {
    const root = globalThis.__TEST_TMP_DIR__;
    // First pass: multi-sheet workbook writes лист/ and лист-1/.
    await new XlsxCurator().curate(ctxFor('multi-sheet.xlsx'));
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'лист', 'data.ndjson'))).toBe(true);

    // Re-curate the SAME resource with a different workbook (one sheet "данни").
    await new XlsxCurator().curate(ctxFor('simple.xlsx'));
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'данни', 'data.ndjson'))).toBe(true);
    // The previous workbook's sheet directories must be gone.
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'лист'))).toBe(false);
    expect(existsSync(join(root, 'curated', 'd1', 'r1', 'лист-1'))).toBe(false);
  });
});
