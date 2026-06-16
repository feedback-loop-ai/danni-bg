import type { EntitiesRepo } from '../../store/repos/entities.ts';
import type { EntityRelationsRepo } from '../../store/repos/entity-relations.ts';
import { MUNICIPALITIES, OBLASTS } from '../gazetteer/bg-admin.ts';
import { ENTITY_PREDICATES } from './vocabulary.ts';

export interface RegisterRelationsOptions {
  entitiesRepo: EntitiesRepo;
  relationsRepo: EntityRelationsRepo;
}

export interface RegisterRelationsResult {
  /** `part_of` edges asserted (municipality -> oblast). */
  created: number;
}

/**
 * Materialise the entity<->entity relation graph from the bundled administrative gazetteer. For
 * every municipality entity present in the corpus (i.e. linked to ≥1 dataset), assert
 * `municipality --part_of--> oblast`, upserting the parent oblast as a node first so the geographic
 * hierarchy is complete even when no dataset referenced the oblast directly.
 *
 * Idempotent (entity upsert + relation upsert are both INSERT OR REPLACE), so it is safe to re-run
 * over the whole catalog after any extraction pass.
 */
export function registerEntityRelations(opts: RegisterRelationsOptions): RegisterRelationsResult {
  const oblastById = new Map(OBLASTS.map((o) => [o.id, o]));
  let created = 0;

  for (const muni of MUNICIPALITIES) {
    // Only relate municipalities that actually surfaced in the corpus.
    if (!opts.entitiesRepo.get(muni.id)) continue;
    const oblast = oblastById.get(muni.oblastId);
    if (!oblast) continue;

    // Ensure the parent oblast exists as a node (it may have no direct dataset link).
    opts.entitiesRepo.upsert({
      id: oblast.id,
      kind: 'geographic_unit',
      canonicalLabelBg: oblast.labelBg,
      canonicalLabelEn: oblast.labelEn,
      attributes: { iso3166_2: oblast.iso3166_2 },
    });
    opts.relationsRepo.upsert({
      subjectId: muni.id,
      predicate: ENTITY_PREDICATES.PART_OF,
      objectId: oblast.id,
      confidence: 1,
      evidence: { source: 'gazetteer' },
    });
    created++;
  }

  return { created };
}
