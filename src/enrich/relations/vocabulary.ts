// Controlled vocabulary for the entity-to-entity relation layer (the knowledge-graph predicates).
//
// `entity_relations` stores directed triples (subject) --predicate--> (object) between canonical
// entities. Keeping the predicate set closed and documented here is what makes the graph "formal":
// every edge's meaning is defined, not inferred from context.
//
// Currently materialized:
//   - PART_OF: a municipality is administratively part of its parent oblast
//     (geo:bg-municipality-* --part_of--> geo:bg-oblast-*). Derived from the bundled gazetteer.
//
// Dataset->entity relationships (publishedBy / locatedIn / about / during / tagged / inGroup) are
// NOT stored here — they live in `dataset_entities`, typed by the linked entity's `kind`. This table
// is exclusively for entity<->entity edges, so the two layers don't duplicate each other.

export const ENTITY_PREDICATES = {
  /** subject (municipality) is administratively part of object (oblast). */
  PART_OF: 'part_of',
} as const;

export type EntityPredicate = (typeof ENTITY_PREDICATES)[keyof typeof ENTITY_PREDICATES];

export const ALL_ENTITY_PREDICATES: readonly EntityPredicate[] = Object.values(ENTITY_PREDICATES);

export function isEntityPredicate(value: string): value is EntityPredicate {
  return (ALL_ENTITY_PREDICATES as readonly string[]).includes(value);
}
