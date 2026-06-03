import type { Database } from 'bun:sqlite';
import { nowIso } from '../../lib/time.ts';

export interface OrganizationRow {
  id: string;
  slug: string;
  title_bg: string;
  description_bg: string | null;
  source_url: string;
  first_seen_at: string;
  last_synced_at: string;
}

export interface UpsertOrganizationInput {
  id: string;
  slug: string;
  titleBg: string;
  descriptionBg?: string | null | undefined;
  sourceUrl: string;
  now?: string;
}

export class OrganizationsRepo {
  constructor(private readonly db: Database) {}

  upsert(input: UpsertOrganizationInput): OrganizationRow {
    const now = input.now ?? nowIso();
    const existing = this.db
      .query<OrganizationRow, [string]>('SELECT * FROM organizations WHERE id = ?')
      .get(input.id);
    if (existing) {
      this.db
        .query(
          'UPDATE organizations SET slug = ?, title_bg = ?, description_bg = ?, source_url = ?, last_synced_at = ? WHERE id = ?',
        )
        .run(
          input.slug,
          input.titleBg,
          input.descriptionBg ?? null,
          input.sourceUrl,
          now,
          input.id,
        );
    } else {
      this.db
        .query(
          'INSERT INTO organizations (id, slug, title_bg, description_bg, source_url, first_seen_at, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          input.id,
          input.slug,
          input.titleBg,
          input.descriptionBg ?? null,
          input.sourceUrl,
          now,
          now,
        );
    }
    return this.get(input.id) as OrganizationRow;
  }

  get(id: string): OrganizationRow | null {
    return (
      this.db.query<OrganizationRow, [string]>('SELECT * FROM organizations WHERE id = ?').get(id) ??
      null
    );
  }
}
