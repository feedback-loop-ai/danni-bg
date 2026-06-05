// Grounding benchmark (T069) — closes SC-004 (>=90% grounded), SC-005 (0% fabricated sources),
// SC-006 (>=95% correct "no relevant public data"). Reuses the eval query-set pattern: a known-answer
// set drives the REAL grounding loop (runChatTurn) with scripted model behaviour, and the harness
// asserts the pipeline's guarantees deterministically — no live LLM (Constitution VI). Real-model
// answer quality is an offline concern; this proves the enforcement layer meets the success criteria.

import type { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { runIndex } from '../../../src/index/run-index.ts';
import { openDb } from '../../../src/store/db.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../../src/store/repos/entities.ts';
import { NO_DATA_REPLY } from '../src/chat/grounding.ts';
import { runChatTurn } from '../src/chat/run.ts';
import { ReadBridge } from '../src/read-bridge.ts';
import queryset from './fixtures/grounding-queryset.json';
import { emptyStep, mockModel, textStep, toolCallStep } from './helpers/mock-model.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

interface Query {
  id: string;
  kind: 'grounded' | 'nodata' | 'fabrication';
  question: string;
  tool?: { name: string; input: Record<string, unknown> };
  answer: string;
  expectCited?: string[];
}
const SET = queryset as unknown as {
  corpus: { id: string; titleBg: string; tags: string[]; geo: string }[];
  queries: Query[];
  thresholds: { grounded: number; noData: number; maxFabricated: number };
};

let db: Database;
let bridge: ReadBridge;
const corpusIds = new Set(SET.corpus.map((c) => c.id));

beforeAll(async () => {
  db = openDb({ storeRoot: globalThis.__TEST_TMP_DIR__ ?? '/tmp', loadVec: false });
  runMigrations(db, join(ROOT, 'migrations'));
  const ds = new DatasetsRepo(db);
  const ents = new EntitiesRepo(db);
  for (const c of SET.corpus) {
    ds.upsert({
      id: c.id,
      slug: c.id,
      titleBg: c.titleBg,
      tags: c.tags,
      groups: [],
      sourceUrl: `https://data.egov.bg/${c.id}`,
    });
    ents.upsert({ id: c.geo, kind: 'geographic_unit', canonicalLabelBg: c.geo });
    ents.attach({ datasetId: c.id, entityId: c.geo, extractor: 'gaz', confidence: 0.9 });
  }
  const embedder = new LocalOnnxEmbedder({ dimension: 8 });
  await runIndex({ db, embedder });
  bridge = new ReadBridge({
    db,
    storeRoot: globalThis.__TEST_TMP_DIR__ ?? '/tmp',
    embedder,
    freshnessSloSeconds: 86400,
  });
});
afterAll(() => db.close());

async function runQuery(q: Query) {
  const steps = [];
  if (q.tool) steps.push(toolCallStep(q.tool.name, q.tool.input));
  steps.push(q.answer === '' ? emptyStep() : textStep(q.answer));
  return runChatTurn({
    model: mockModel(steps),
    bridge,
    scope: {},
    messages: [{ role: 'user', content: q.question }],
  });
}

describe('grounding benchmark', () => {
  it('meets SC-004/005/006 across the known-answer query set', async () => {
    let groundedTotal = 0;
    let groundedHit = 0;
    let noDataTotal = 0;
    let noDataHit = 0;
    let fabricatedCitations = 0;

    for (const q of SET.queries) {
      const result = await runQuery(q);

      // SC-005: every emitted citation MUST resolve to a real corpus dataset — 0% fabricated sources.
      for (const c of result.citations) {
        if (!corpusIds.has(c.datasetId)) fabricatedCitations += 1;
      }

      if (q.kind === 'grounded') {
        groundedTotal += 1;
        const cited = new Set(result.citations.map((c) => c.datasetId));
        const expected = q.expectCited ?? [];
        if (result.citations.length > 0 && expected.every((id) => cited.has(id))) groundedHit += 1;
      } else if (q.kind === 'nodata') {
        noDataTotal += 1;
        if (result.text === NO_DATA_REPLY && result.citations.length === 0) noDataHit += 1;
      } else {
        // fabrication: the referenced dataset does not exist → it MUST NOT appear as a citation.
        expect(result.citations).toEqual([]);
      }
    }

    const groundedRate = groundedHit / groundedTotal;
    const noDataRate = noDataHit / noDataTotal;

    expect(groundedRate).toBeGreaterThanOrEqual(SET.thresholds.grounded); // SC-004
    expect(fabricatedCitations).toBeLessThanOrEqual(SET.thresholds.maxFabricated); // SC-005
    expect(noDataRate).toBeGreaterThanOrEqual(SET.thresholds.noData); // SC-006
  });
});
