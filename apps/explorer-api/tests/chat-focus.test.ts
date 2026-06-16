// Focused-dataset grounding (anti-fabrication): when the user focuses a dataset ("ask about this
// dataset"), the chat must answer from its actual rows, not confabulate from the title. We pre-read
// a sample and hand it over as ground truth, and always cite the focused dataset.

import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import type { ResourceContent } from '../../../src/read/resource-rows.ts';
import { openDb } from '../../../src/store/db.ts';
import { runMigrations } from '../../../src/store/migrate.ts';
import { DatasetsRepo } from '../../../src/store/repos/datasets.ts';
import { buildFocusContext, runChatTurn } from '../src/chat/run.ts';
import { ReadBridge } from '../src/read-bridge.ts';
import { mockModel, textStep } from './helpers/mock-model.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('buildFocusContext', () => {
  it('reads the focused dataset rows and surfaces real values (no fabrication needed)', () => {
    // Stub bridge: a register whose single resource holds two distinct, real clubs.
    const rows = [
      { ime: '"Спортен боен клуб Ихтиман"', eik: 176249101 },
      { ime: '"Футболен клуб Мътивир"', eik: 175130090 },
    ];
    const fakeBridge = {
      view: (id: string) => ({
        datasetId: id,
        title: { bg: 'Регистър на спортните клубове в Община Ихтиман' },
        resources: [{ resourceId: 'r1', name: 'Регистър 2019' }],
      }),
      rows: (): ResourceContent => ({ rows, total: 16 }) as unknown as ResourceContent,
    } as unknown as ReadBridge;
    const resolve = (id: string) => fakeBridge.view(id) as never;

    const focus = buildFocusContext(fakeBridge, ['ds-1'], resolve);
    expect(focus).not.toBeNull();
    expect(focus?.ids).toEqual(['ds-1']);
    // The actual row values are in the context — the model never needs to invent them.
    expect(focus?.text).toContain('Спортен боен клуб Ихтиман');
    expect(focus?.text).toContain('176249101');
    expect(focus?.text).toContain('16 реда');
  });

  it('returns null when there is no focus', () => {
    const bridge = { view: () => null } as unknown as ReadBridge;
    expect(buildFocusContext(bridge, [], () => null)).toBeNull();
  });

  it('bounds the injected context to a char budget for a large dataset', () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: 'x'.repeat(80) }));
    const fakeBridge = {
      view: (id: string) => ({
        datasetId: id,
        title: { bg: 'Голям набор' },
        resources: [{ resourceId: 'r1', name: 'R' }],
      }),
      rows: (): ResourceContent => ({ rows: big, total: 2000 }) as unknown as ResourceContent,
    } as unknown as ReadBridge;
    const focus = buildFocusContext(fakeBridge, ['ds'], (id) => fakeBridge.view(id) as never);
    expect(focus).not.toBeNull();
    // Raw would be ~180k chars; the budget caps it well under that and flags the partial sample.
    expect(focus?.text.length ?? 0).toBeLessThan(100_000);
    expect(focus?.text).toContain('частична извадка');
  });
});

describe('runChatTurn focused-dataset grounding', () => {
  let db: Database;
  let bridge: ReadBridge;

  beforeEach(() => {
    const storeRoot = globalThis.__TEST_TMP_DIR__;
    db = openDb({ storeRoot, loadVec: false });
    runMigrations(db, join(ROOT, 'migrations'));
    new DatasetsRepo(db).upsert({
      id: 'd1',
      slug: 'd1',
      titleBg: 'Регистър на спортните клубове',
      tags: [],
      groups: [],
      sourceUrl: 'https://data.egov.bg/d1',
    });
    bridge = new ReadBridge({
      db,
      storeRoot,
      embedder: new LocalOnnxEmbedder({ dimension: 8 }),
      freshnessSloSeconds: 86400,
    });
  });
  afterEach(() => db.close());

  it('cites the focused dataset even when the model calls no tools', async () => {
    // The previous failure mode: the model answers from the title without reading rows. The focus
    // wiring must still attribute the answer to the focused dataset.
    const result = await runChatTurn({
      model: mockModel([textStep('Това е регистър на спортни клубове.')]),
      bridge,
      scope: { datasetIds: ['d1'] },
      messages: [{ role: 'user', content: 'какво съдържа този набор?' }],
    });
    expect(result.citations.map((c) => c.datasetId)).toEqual(['d1']);
  });
});
