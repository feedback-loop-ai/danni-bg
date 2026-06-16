import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerEntityRelations } from '../../../../src/enrich/relations/register-relations.ts';
import { runMigrations } from '../../../../src/store/migrate.ts';
import { EntitiesRepo } from '../../../../src/store/repos/entities.ts';
import { EntityRelationsRepo } from '../../../../src/store/repos/entity-relations.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'migrations');

function setup(): { db: Database; entities: EntitiesRepo; relations: EntityRelationsRepo } {
  const d = new Database(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  runMigrations(d, MIGRATIONS);
  return { db: d, entities: new EntitiesRepo(d), relations: new EntityRelationsRepo(d) };
}

describe('enrich.relations.register-relations', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });
  afterEach(() => {
    s.db.close();
  });

  it('asserts part_of for present municipalities and creates the parent oblast node', () => {
    // Only Stolichna is present in the corpus.
    s.entities.upsert({
      id: 'geo:bg-municipality-stolichna',
      kind: 'geographic_unit',
      canonicalLabelBg: 'Столична',
    });

    const res = registerEntityRelations({ entitiesRepo: s.entities, relationsRepo: s.relations });

    // Exactly one present municipality → one edge.
    expect(res.created).toBe(1);
    // Parent oblast was upserted as a node even though no dataset referenced it directly.
    expect(s.entities.get('geo:bg-oblast-sofia-grad')).not.toBeNull();
    const out = s.relations.bySubject('geo:bg-municipality-stolichna', 'part_of');
    expect(out).toHaveLength(1);
    expect(out[0]?.object_id).toBe('geo:bg-oblast-sofia-grad');
    expect(out[0]?.confidence).toBe(1);
  });

  it('skips municipalities that are not present in the corpus', () => {
    // No entities seeded → nothing to relate.
    const res = registerEntityRelations({ entitiesRepo: s.entities, relationsRepo: s.relations });
    expect(res.created).toBe(0);
    expect(s.relations.count()).toBe(0);
  });

  it('is idempotent across re-runs', () => {
    s.entities.upsert({
      id: 'geo:bg-municipality-stolichna',
      kind: 'geographic_unit',
      canonicalLabelBg: 'Столична',
    });
    registerEntityRelations({ entitiesRepo: s.entities, relationsRepo: s.relations });
    registerEntityRelations({ entitiesRepo: s.entities, relationsRepo: s.relations });
    expect(s.relations.count()).toBe(1);
  });
});
