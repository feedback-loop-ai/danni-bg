import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { writeManifest } from '../../src/manifest/writer.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCHEMA_PATH = join(ROOT, 'specs/001-egov-data-sync/contracts/manifest.schema.json');

interface JsonSchema {
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema & { const?: unknown; enum?: unknown[] }>;
  $defs?: Record<string, JsonSchema>;
}

function buildZodFromSchema(schema: JsonSchema, defs: Record<string, JsonSchema>): z.ZodTypeAny {
  if ((schema as { $ref?: string }).$ref) {
    const ref = (schema as { $ref: string }).$ref.replace('#/$defs/', '');
    return buildZodFromSchema(defs[ref] as JsonSchema, defs);
  }
  if ((schema as { enum?: unknown[] }).enum) {
    return z.enum((schema as { enum: string[] }).enum as [string, ...string[]]);
  }
  if ((schema as { const?: unknown }).const !== undefined) {
    return z.literal((schema as { const: string }).const);
  }
  const t = (schema as { type?: string }).type;
  if (t === 'string') return z.string();
  if (t === 'integer') return z.number().int();
  if (t === 'number') return z.number();
  if (t === 'boolean') return z.boolean();
  if (t === 'array') {
    const items = (schema as { items?: JsonSchema }).items ?? {};
    return z.array(buildZodFromSchema(items, defs));
  }
  if (t === 'object' || (schema as { properties?: unknown }).properties) {
    const obj: Record<string, z.ZodTypeAny> = {};
    const required = new Set((schema as JsonSchema).required ?? []);
    for (const [k, v] of Object.entries((schema as JsonSchema).properties ?? {})) {
      const inner = buildZodFromSchema(v as JsonSchema, defs);
      obj[k] = required.has(k) ? inner : inner.optional();
    }
    const base = z.object(obj);
    if ((schema as JsonSchema).additionalProperties === false) {
      return base.strict();
    }
    return base;
  }
  return z.unknown();
}

function loadManifestValidator(): z.ZodTypeAny {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as JsonSchema;
  const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>;
  return buildZodFromSchema(schema, defs);
}

describe('contract.manifest', () => {
  it('written manifest validates against contracts/manifest.schema.json', () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    const path = writeManifest(storeRoot, {
      manifestVersion: '1.0.0',
      runId: '01HABC',
      trigger: 'manual',
      scopeFilter: { publishers: ['p1'] },
      startedAt: '2026-05-08T00:00:00Z',
      endedAt: '2026-05-08T00:01:00Z',
      summaryOutcome: 'success',
      totals: {
        discovered: 1,
        captured: 1,
        skippedUnchanged: 0,
        failed: 0,
        withdrawn: 0,
        outOfScope: 0,
      },
      datasets: [
        {
          datasetId: 'd1',
          sourceUrl: 'https://x/d1',
          outcome: 'captured',
          lifecycleState: 'active',
          capturedAt: '2026-05-08T00:00:30Z',
          metadataHash: 'a'.repeat(64),
          resources: [
            {
              resourceId: 'r1',
              sourceUrl: 'https://x/d1.csv',
              outcome: 'captured',
              bytes: 1024,
              sha256: 'b'.repeat(64),
              rawPath: 'd1/r1/abc.csv',
              declaredFormat: 'csv',
              detectedContentType: 'text/csv',
              etag: '"x"',
              httpStatus: 200,
            },
          ],
        },
      ],
    });
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    const validator = loadManifestValidator();
    const result = validator.safeParse(parsed);
    if (!result.success) {
      throw new Error(`manifest schema violation: ${JSON.stringify(result.error.issues)}`);
    }
    expect(result.success).toBe(true);
  });

  it('rejects a manifest missing required totals fields', () => {
    const validator = loadManifestValidator();
    const bad = {
      manifestVersion: '1.0.0',
      runId: 'r',
      trigger: 'manual',
      scopeFilter: {},
      startedAt: '2026-05-08T00:00:00Z',
      endedAt: '2026-05-08T00:01:00Z',
      summaryOutcome: 'success',
      totals: { discovered: 0 },
      datasets: [],
    };
    expect(validator.safeParse(bad).success).toBe(false);
  });
});
