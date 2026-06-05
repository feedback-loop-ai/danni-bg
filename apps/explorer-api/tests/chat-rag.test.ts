// RAG fallback (tool-choice-unsupported providers): runChatTurn retries without tools, retrieving
// scoped datasets itself and feeding them as context. Grounding guarantees still hold (citations are
// the retrieved, in-scope datasets — all real).

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import { runIndex } from '../../../src/index/run-index.ts';
import { openDb } from '../../../src/store/db.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { EntitiesRepo } from '../../../src/store/repos/entities.ts';
import { NO_DATA_REPLY } from '../src/chat/grounding.ts';
import { isToolChoiceUnsupported, runChatTurn } from '../src/chat/run.ts';
import { ReadBridge } from '../src/read-bridge.ts';
import { emptyStep, errorStep, mockModel, textStep } from './helpers/mock-model.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TOOL_ERR = new Error(
  '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser',
);

describe('isToolChoiceUnsupported', () => {
  it('matches tool-choice rejection messages, not unrelated errors', () => {
    expect(isToolChoiceUnsupported(TOOL_ERR)).toBe(true);
    expect(isToolChoiceUnsupported(new Error('does not support tools'))).toBe(true);
    expect(isToolChoiceUnsupported('rate limited')).toBe(false);
    expect(isToolChoiceUnsupported(new Error('connection refused'))).toBe(false);
  });
});

describe('runChatTurn RAG fallback', () => {
  let db: Database;
  let bridge: ReadBridge;

  beforeEach(async () => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    new DatasetsRepo(db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Качество на въздуха',
      tags: ['въздух'],
      groups: [],
      sourceUrl: 'https://data.egov.bg/d1',
    });
    const ents = new EntitiesRepo(db);
    ents.upsert({
      id: 'geo:bg-oblast-sofia-grad',
      kind: 'geographic_unit',
      canonicalLabelBg: 'София (град)',
    });
    ents.attach({
      datasetId: 'd1',
      entityId: 'geo:bg-oblast-sofia-grad',
      extractor: 'g',
      confidence: 0.9,
    });
    const embedder = new LocalOnnxEmbedder({ dimension: 8 });
    await runIndex({ db, embedder });
    bridge = new ReadBridge({ db, storeRoot, embedder, freshnessSloSeconds: 86400 });
  });
  afterEach(() => db.close());

  it('falls back to retrieval + cites the in-scope dataset (with map anchor)', async () => {
    const tools: string[] = [];
    const result = await runChatTurn({
      model: mockModel([errorStep(TOOL_ERR), textStep('Има данни за качеството на въздуха.')]),
      bridge,
      scope: {},
      messages: [{ role: 'user', content: 'въздух качество' }],
      events: { onTool: (n, s) => tools.push(`${n}:${s}`) },
    });
    expect(result.citations.map((c) => c.datasetId)).toEqual(['d1']);
    expect(result.anchors.geoEntityIds).toContain('geo:bg-oblast-sofia-grad');
    expect(tools).toEqual(['mirrorSearch:start', 'mirrorSearch:done']);
  });

  it('returns no-data (no citations) when nothing is in scope', async () => {
    const result = await runChatTurn({
      model: mockModel([errorStep(TOOL_ERR)]), // RAG returns early; model not called again
      bridge,
      scope: { geoUnitIds: ['geo:bg-oblast-varna'] },
      messages: [{ role: 'user', content: 'въздух' }],
    });
    expect(result.text).toBe(NO_DATA_REPLY);
    expect(result.citations).toEqual([]);
  });

  it('returns no-data when the model produces no answer text', async () => {
    const result = await runChatTurn({
      model: mockModel([errorStep(TOOL_ERR), emptyStep()]),
      bridge,
      scope: {},
      messages: [{ role: 'user', content: 'въздух' }],
    });
    expect(result.citations).toEqual([]);
  });

  it('rethrows non-tool-choice errors', async () => {
    await expect(
      runChatTurn({
        model: mockModel([errorStep(new Error('connection refused'))]),
        bridge,
        scope: {},
        messages: [{ role: 'user', content: 'въздух' }],
      }),
    ).rejects.toThrow('connection refused');
  });
});
