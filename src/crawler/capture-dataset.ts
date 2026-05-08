import type { Database } from 'bun:sqlite';
import { sha256Hex } from '../lib/hash.ts';
import { withTransaction } from '../store/db.ts';
import { DatasetRevisionsRepo } from '../store/repos/dataset-revisions.ts';
import { DatasetsRepo, type LifecycleState } from '../store/repos/datasets.ts';
import { OrganizationsRepo } from '../store/repos/organizations.ts';
import { type ResourceRow, ResourcesRepo } from '../store/repos/resources.ts';
import type { CkanClient } from './ckan-client.ts';
import type { Package } from './ckan-schema.ts';

export interface CaptureDatasetOptions {
  db: Database;
  client: CkanClient;
  runId: string;
  portalBaseUrl: string;
}

export interface CapturedDataset {
  pkg: Package;
  resources: ResourceRow[];
  metadataHash: string;
  changes: Array<{ field: string; oldValue: string | null; newValue: string | null }>;
}

function datasetSourceUrl(portalBaseUrl: string, slug: string): string {
  const root = portalBaseUrl.replace(/\/api\/?\d?\/?action\/?$/, '');
  return `${root.replace(/\/$/, '')}/data/dataset/${slug}`;
}

export async function captureDataset(
  opts: CaptureDatasetOptions,
  datasetId: string,
  lifecycleState: LifecycleState = 'active',
): Promise<CapturedDataset> {
  const res = await opts.client.packageShow(datasetId);
  const pkg = res.result;
  const metadataHash = sha256Hex(
    JSON.stringify({
      id: pkg.id,
      name: pkg.name,
      title: pkg.title,
      notes: pkg.notes,
      metadata_modified: pkg.metadata_modified,
      license_id: pkg.license_id,
      organization: pkg.organization,
      tags: pkg.tags.map((t) => t.name).sort(),
      groups: pkg.groups.map((g) => g.id).sort(),
      resources: pkg.resources.map((r) => ({
        id: r.id,
        url: r.url,
        last_modified: r.last_modified,
      })),
    }),
  );

  const orgs = new OrganizationsRepo(opts.db);
  const datasets = new DatasetsRepo(opts.db);
  const resources = new ResourcesRepo(opts.db);
  const revisions = new DatasetRevisionsRepo(opts.db);

  return withTransaction(opts.db, () => {
    if (pkg.organization) {
      orgs.upsert({
        id: pkg.organization.id,
        slug: pkg.organization.name,
        titleBg: pkg.organization.title,
        descriptionBg: pkg.organization.description ?? null,
        sourceUrl: datasetSourceUrl(opts.portalBaseUrl, pkg.organization.name).replace(
          '/data/dataset/',
          '/data/organization/',
        ),
      });
    }

    const upsert = datasets.upsert({
      id: pkg.id,
      slug: pkg.name,
      titleBg: pkg.title,
      descriptionBg: pkg.notes ?? null,
      publisherId: pkg.organization?.id ?? null,
      licenseId: pkg.license_id ?? null,
      tags: pkg.tags.map((t) => t.name),
      groups: pkg.groups.map((g) => g.id),
      sourceUrl: datasetSourceUrl(opts.portalBaseUrl, pkg.name),
      metadataCreated: pkg.metadata_created ?? null,
      metadataModified: pkg.metadata_modified ?? null,
      sourceEtagOrHash: metadataHash,
      lifecycleState,
    });

    for (const change of upsert.changes) {
      revisions.insert({
        datasetId: pkg.id,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        runId: opts.runId,
      });
    }

    const rows: ResourceRow[] = [];
    for (const [idx, r] of pkg.resources.entries()) {
      const row = resources.upsert({
        id: r.id,
        datasetId: pkg.id,
        position: r.position ?? idx,
        name: r.name ?? null,
        descriptionBg: r.description ?? null,
        declaredFormat: r.format ?? null,
        sourceUrl: r.url,
        lifecycleState,
      });
      rows.push(row);
    }

    return { pkg, resources: rows, metadataHash, changes: upsert.changes };
  });
}
