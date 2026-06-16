import type { OrganizationsRepo } from '../../store/repos/organizations.ts';
import type { EntityCandidate, ExtractContext, Extractor } from '../extractor.ts';
import { findGazetteerMatches } from '../gazetteer/bg-admin.ts';

/**
 * Infers a dataset's administrative place from its PUBLISHER organisation's name
 * (e.g. "Община Бургас" → Бургас, "Регионално управление на образованието - Пловдив" → Пловдив).
 * This recovers the large class of municipal/regional datasets whose own title and description
 * name no place at all — without it they fall into the non-georeferenced "national" grouping.
 *
 * Matches are emitted at a LOWER confidence than {@link BgAdminGazetteerExtractor}'s in-content
 * matches: a publisher affiliation is a weaker placement signal than the dataset itself naming the
 * place. When a dataset matches both ways, dataset_entities keeps one row per extractor (its PK
 * includes the extractor), and the read layer takes the max confidence per (dataset, entity) — so
 * the stronger in-content confidence wins downstream.
 */
export class BgAdminPublisherExtractor implements Extractor {
  readonly id = 'bg_admin_publisher';

  constructor(private readonly orgs: OrganizationsRepo) {}

  async extract(ctx: ExtractContext): Promise<EntityCandidate[]> {
    if (!ctx.dataset.publisher_id) return [];
    const org = this.orgs.get(ctx.dataset.publisher_id);
    if (!org) return [];
    const matches = findGazetteerMatches(org.title_bg);
    return matches.map((m) => ({
      id: m.id,
      kind: 'geographic_unit',
      canonicalLabelBg: m.labelBg,
      canonicalLabelEn: m.labelEn,
      attributes: m.attributes,
      evidence: { source: 'publisher', publisherId: org.id, matchType: m.matchType, kind: m.kind },
      confidence: m.matchType === 'canonical' ? 0.7 : 0.6,
    }));
  }
}
