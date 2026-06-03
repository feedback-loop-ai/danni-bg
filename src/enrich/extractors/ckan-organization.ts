import type { OrganizationsRepo } from '../../store/repos/organizations.ts';
import type { EntityCandidate, ExtractContext, Extractor } from '../extractor.ts';

export class CkanOrganizationExtractor implements Extractor {
  readonly id = 'ckan_organization';

  constructor(private readonly orgs: OrganizationsRepo) {}

  async extract(ctx: ExtractContext): Promise<EntityCandidate[]> {
    if (!ctx.dataset.publisher_id) return [];
    const org = this.orgs.get(ctx.dataset.publisher_id);
    if (!org) return [];
    return [
      {
        id: `org:${org.id}`,
        kind: 'organization',
        canonicalLabelBg: org.title_bg,
        attributes: { slug: org.slug, sourceUrl: org.source_url },
        evidence: { source: 'ckan.organization' },
        confidence: 1.0,
      },
    ];
  }
}
