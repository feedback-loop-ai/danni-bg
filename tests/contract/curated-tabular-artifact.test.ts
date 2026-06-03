import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CsvCurator } from '../../src/curate/csv.ts';
import { XlsxCurator } from '../../src/curate/xlsx.ts';
import { ensureDir } from '../../src/lib/fs.ts';
import type { ResourceRow } from '../../src/store/repos/resources.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = fileURLToPath(new URL('../fixtures/resources/', import.meta.url));
const XLSX_FIX = fileURLToPath(new URL('../fixtures/xlsx/', import.meta.url));

const ColumnSchema = z
  .object({
    canonicalName: z.string().regex(/^[a-z][a-z0-9_]*$/),
    sourceName: z.string(),
    labelBg: z.string().nullable().optional(),
    labelEn: z.string().nullable().optional(),
    type: z.enum([
      'string',
      'integer',
      'decimal',
      'boolean',
      'date',
      'datetime',
      'time',
      'geo_point',
      'geo_geometry',
      'json',
      'binary',
    ]),
    nullable: z.boolean(),
    format: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    interpretationConfidence: z.number().min(0).max(1).optional(),
    alternateInterpretations: z
      .array(
        z.object({
          type: z.string(),
          format: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1),
        }),
      )
      .optional(),
  })
  .strict();

const TabularSchema = z
  .object({
    kind: z.literal('tabular'),
    encoding: z.literal('utf-8'),
    rowFormat: z.literal('ndjson'),
    rowCount: z.number().int().min(0).nullable().optional(),
    columns: z.array(ColumnSchema).min(1),
    primaryKey: z.array(z.string()).nullable().optional(),
    transformRules: z.array(z.unknown()).optional(),
  })
  .strict();

function fakeResource(): ResourceRow {
  return {
    id: 'r1',
    dataset_id: 'd1',
    position: 0,
    name: 'r1',
    description_bg: null,
    declared_format: 'csv',
    detected_content_type: null,
    detected_format: null,
    source_url: 'https://example.org/r1.csv',
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
  };
}

describe('contract.curated-tabular-artifact', () => {
  it('CSV curator output validates against curated-tabular-artifact.schema.json shape', async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    ensureDir(join(storeRoot, 'raw', 'd1', 'r1'));
    const path = join(storeRoot, 'raw', 'd1', 'r1', 'in.csv');
    writeFileSync(path, 'name,age\nIvan,30\nMaria,25\n');
    const out = await new CsvCurator().curate({
      storeRoot,
      resource: fakeResource(),
      rawAbsPath: path,
      curatorVersion: 'test',
    });
    const result = TabularSchema.safeParse(out.schema);
    if (!result.success) throw new Error(JSON.stringify(result.error.issues));
    expect(result.success).toBe(true);
    expect(out.path.endsWith('data.ndjson')).toBe(true);
    void ROOT;
    void FIX;
  });

  it.each(['simple.xlsx', 'multi-sheet.xlsx', 'header-only.xlsx'])(
    'XLSX curator output + every per-sheet schema.json validates the tabular contract (%s)',
    async (file) => {
      const storeRoot = globalThis.__TEST_TMP_DIR__;
      const out = await new XlsxCurator().curate({
        storeRoot,
        resource: fakeResource(),
        rawAbsPath: join(XLSX_FIX, file),
        curatorVersion: 'test',
      });
      // The schema returned in the artifact output (persisted to the DB row).
      const outResult = TabularSchema.safeParse(out.schema);
      if (!outResult.success) throw new Error(JSON.stringify(outResult.error.issues));
      expect(outResult.success).toBe(true);
      expect(out.path.endsWith('data.ndjson')).toBe(true);

      // Every per-sheet schema.json written to disk must also conform.
      const resourceDir = join(storeRoot, 'curated', 'd1', 'r1');
      const sheetDirs = readdirSync(resourceDir, { withFileTypes: true }).filter((e) =>
        e.isDirectory(),
      );
      expect(sheetDirs.length).toBeGreaterThan(0);
      for (const dir of sheetDirs) {
        const schema = JSON.parse(
          readFileSync(join(resourceDir, dir.name, 'schema.json'), 'utf-8'),
        );
        const parsed = TabularSchema.safeParse(schema);
        if (!parsed.success) throw new Error(`${dir.name}: ${JSON.stringify(parsed.error.issues)}`);
        expect(parsed.success).toBe(true);
      }
    },
  );
});
