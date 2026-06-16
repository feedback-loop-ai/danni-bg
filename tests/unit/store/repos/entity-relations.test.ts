import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { EntitiesRepo } from '../../../../src/store/repos/entities.ts';
import { EntityRelationsRepo } from '../../../../src/store/repos/entity-relations.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): { db: Database; repo: EntityRelationsRepo } {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  const ents = new EntitiesRepo(d);
  // entity_relations FKs into entities, so endpoints must exist first.
  ents.upsert({ id: 'geo:bg-municipality-stolichna', kind: 'geographic_unit', canonicalLabelBg: 'Столична' });
  ents.upsert({ id: 'geo:bg-municipality-bankya', kind: 'geographic_unit', canonicalLabelBg: 'Банкя' });
  ents.upsert({ id: 'geo:bg-oblast-sofia-grad', kind: 'geographic_unit', canonicalLabelBg: 'София (град)' });
  return { db: d, repo: new EntityRelationsRepo(d) };
}

describe('store.repos.entity-relations', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('asserts triples and reads them by subject and by object', () => {
    s.repo.upsert({
      subjectId: 'geo:bg-municipality-stolichna',
      predicate: 'part_of',
      objectId: 'geo:bg-oblast-sofia-grad',
      confidence: 1,
      evidence: { source: 'gazetteer' },
    });
    s.repo.upsert({
      subjectId: 'geo:bg-municipality-bankya',
      predicate: 'part_of',
      objectId: 'geo:bg-oblast-sofia-grad',
      confidence: 1,
    });

    const out = s.repo.bySubject('geo:bg-municipality-stolichna', 'part_of');
    expect(out).toHaveLength(1);
    expect(out[0]?.object_id).toBe('geo:bg-oblast-sofia-grad');
    expect(JSON.parse(out[0]?.evidence_json ?? '{}')).toEqual({ source: 'gazetteer' });

    // Reverse traversal: the oblast's two child municipalities.
    const children = s.repo.byObject('geo:bg-oblast-sofia-grad', 'part_of');
    expect(children.map((r) => r.subject_id).sort()).toEqual([
      'geo:bg-municipality-bankya',
      'geo:bg-municipality-stolichna',
    ]);
    expect(s.repo.count()).toBe(2);
  });

  it('is idempotent on (subject, predicate, object)', () => {
    const edge = {
      subjectId: 'geo:bg-municipality-stolichna',
      predicate: 'part_of' as const,
      objectId: 'geo:bg-oblast-sofia-grad',
      confidence: 0.5,
    };
    s.repo.upsert(edge);
    s.repo.upsert({ ...edge, confidence: 1 }); // re-assert with new confidence
    const out = s.repo.bySubject('geo:bg-municipality-stolichna');
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(1);
    expect(s.repo.count()).toBe(1);
  });
});
