import type { DatasetLinksRepo } from '../store/repos/dataset-links.ts';
import type { EntitiesRepo, EntityKind } from '../store/repos/entities.ts';

export interface LinkOptions {
  entitiesRepo: EntitiesRepo;
  linksRepo: DatasetLinksRepo;
}

const HEURISTIC_BY_KIND: Record<EntityKind, string> = {
  organization: 'shared_publisher',
  geographic_unit: 'shared_geo',
  time_period: 'shared_time',
  named_subject: 'shared_subject',
  tag: 'shared_tag',
  group: 'shared_group',
};

const CONFIDENCE_BY_KIND: Record<EntityKind, number> = {
  organization: 0.95,
  geographic_unit: 0.9,
  time_period: 0.7,
  named_subject: 0.6,
  tag: 0.5,
  group: 0.7,
};

export interface LinkResult {
  created: number;
}

export function linkDatasetsForEntity(opts: LinkOptions, entityId: string): LinkResult {
  const ent = opts.entitiesRepo.get(entityId);
  if (!ent) return { created: 0 };
  const datasets = opts.entitiesRepo.datasetsForEntity(entityId);
  let created = 0;
  for (let i = 0; i < datasets.length; i++) {
    for (let j = i + 1; j < datasets.length; j++) {
      const a = datasets[i];
      const b = datasets[j];
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      opts.linksRepo.insert({
        datasetA: a,
        datasetB: b,
        viaEntityId: entityId,
        heuristic: HEURISTIC_BY_KIND[ent.kind],
        confidence: CONFIDENCE_BY_KIND[ent.kind],
      });
      created++;
    }
  }
  return { created };
}

export function linkAllSharedEntities(opts: LinkOptions, entityIds: string[]): LinkResult {
  let created = 0;
  for (const id of entityIds) {
    created += linkDatasetsForEntity(opts, id).created;
  }
  return { created };
}
