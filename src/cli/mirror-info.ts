import { resolve } from 'node:path';
import { loadConfig } from '../config/loader.ts';
import { openDb } from '../store/db.ts';
import { CuratedArtifactsRepo } from '../store/repos/curated-artifacts.ts';
import type { CuratedKind } from '../store/repos/curated-artifacts.ts';
import { DatasetLinksRepo } from '../store/repos/dataset-links.ts';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import { EntitiesRepo } from '../store/repos/entities.ts';
import { OrganizationsRepo } from '../store/repos/organizations.ts';
import { ResourcesRepo } from '../store/repos/resources.ts';
import { TranslationsRepo } from '../store/repos/translations.ts';

interface MirrorInfoFlags {
  json?: boolean;
}

export function parseFlags(args: string[]): { id: string; flags: MirrorInfoFlags } {
  let id: string | undefined;
  const flags: MirrorInfoFlags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('danni mirror-info <dataset_id> [--json]\n');
      throw new Error('__HELP__');
    } else if (!a?.startsWith('--')) {
      id = a;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!id) throw new Error('missing <dataset_id>');
  return { id, flags };
}

interface CuratedDatasetView {
  datasetId: string;
  slug: string;
  sourceUrl: string;
  publisher: { id: string; slug: string; title: { bg: string } } | null;
  title: {
    bg: string;
    en: string | null;
    translator: string | null;
    translationConfidence: number | null;
  };
  description: {
    bg: string;
    en: string | null;
    translator: string | null;
    translationConfidence: number | null;
  };
  tags: string[];
  groups: string[];
  license: string | null;
  lifecycleState: string;
  withdrawnReason: string | null;
  freshness: {
    lastSyncedAt: string;
    sourceLastModified: string | null;
    sourceEtagOrHash: string | null;
    isStale: boolean;
    freshnessSloSeconds: number;
  };
  resources: Array<{
    resourceId: string;
    sourceUrl: string;
    name: string | null;
    kind: CuratedKind | null;
    rawPath: string | null;
    curatedPath: string | null;
    declaredFormat: string | null;
    detectedFormat: string | null;
    schema: unknown;
    transformRules: unknown[];
    freshness: {
      lastSyncedAt: string;
      sourceLastModified: string | null;
      sourceEtagOrHash: string | null;
      isStale: boolean;
      freshnessSloSeconds: number;
    };
  }>;
  entities: Array<{
    entityId: string;
    kind: string;
    label: { bg: string; en: string | null };
    extractor: string;
    confidence: number;
  }>;
  links: Array<{
    otherDatasetId: string;
    viaEntityId: string;
    heuristic: string;
    confidence: number;
  }>;
}

export async function run(args: string[]): Promise<number> {
  let id: string;
  let flags: MirrorInfoFlags;
  try {
    const parsed = parseFlags(args);
    id = parsed.id;
    flags = parsed.flags;
  } catch (err) {
    if (err instanceof Error && err.message === '__HELP__') return 0;
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const config = loadConfig();
  const storeRoot = resolve(process.cwd(), config.store.root);
  const db = openDb({ storeRoot, loadVec: false });
  try {
    const dataset = new DatasetsRepo(db).get(id);
    if (!dataset) {
      process.stderr.write(`dataset ${id} not found\n`);
      return 4;
    }
    const view = composeView(db, dataset.id, config.store.freshnessSloSeconds);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
    } else {
      process.stdout.write(`Dataset: ${view.datasetId}\n`);
      process.stdout.write(`Title: ${view.title.bg}\n`);
      if (view.title.en) process.stdout.write(`Title (en): ${view.title.en}\n`);
      process.stdout.write(`Resources: ${view.resources.length}\n`);
      process.stdout.write(`Entities: ${view.entities.length}\n`);
      process.stdout.write(`Links: ${view.links.length}\n`);
    }
    return 0;
  } finally {
    db.close();
  }
}

export function composeView(
  db: ReturnType<typeof openDb>,
  datasetId: string,
  freshnessSloSeconds: number,
): CuratedDatasetView {
  const datasetsRepo = new DatasetsRepo(db);
  const resourcesRepo = new ResourcesRepo(db);
  const orgsRepo = new OrganizationsRepo(db);
  const artifactsRepo = new CuratedArtifactsRepo(db);
  const entitiesRepo = new EntitiesRepo(db);
  const linksRepo = new DatasetLinksRepo(db);
  const translationsRepo = new TranslationsRepo(db);

  const dataset = datasetsRepo.get(datasetId);
  if (!dataset) throw new Error(`dataset ${datasetId} not found`);
  const titleTx = translationsRepo.forSubject('dataset_title', datasetId)[0];
  const descTx = translationsRepo.forSubject('dataset_description', datasetId)[0];
  const org = dataset.publisher_id ? orgsRepo.get(dataset.publisher_id) : null;
  const artifacts = artifactsRepo.byDataset(datasetId);
  const resources = resourcesRepo.listByDataset(datasetId);
  const isStale = (lastSyncedAt: string): boolean => {
    const ms = Date.now() - new Date(lastSyncedAt).getTime();
    return ms / 1000 > freshnessSloSeconds;
  };

  return {
    datasetId: dataset.id,
    slug: dataset.slug,
    sourceUrl: dataset.source_url,
    publisher: org ? { id: org.id, slug: org.slug, title: { bg: org.title_bg } } : null,
    title: {
      bg: dataset.title_bg,
      en: titleTx?.text_en ?? null,
      translator: titleTx?.translator ?? null,
      translationConfidence: titleTx?.confidence ?? null,
    },
    description: {
      bg: dataset.description_bg ?? '',
      en: descTx?.text_en ?? null,
      translator: descTx?.translator ?? null,
      translationConfidence: descTx?.confidence ?? null,
    },
    tags: JSON.parse(dataset.tags_json) as string[],
    groups: JSON.parse(dataset.groups_json) as string[],
    license: dataset.license_id,
    lifecycleState: dataset.lifecycle_state,
    withdrawnReason: dataset.withdrawn_reason,
    freshness: {
      lastSyncedAt: dataset.last_synced_at,
      sourceLastModified: dataset.metadata_modified,
      sourceEtagOrHash: dataset.source_etag_or_hash,
      isStale: isStale(dataset.last_synced_at),
      freshnessSloSeconds,
    },
    resources: resources.map((r) => {
      const artifact = artifacts.find((a) => a.resource_id === r.id);
      return {
        resourceId: r.id,
        sourceUrl: r.source_url,
        name: r.name,
        kind: artifact?.kind ?? null,
        rawPath: r.raw_path,
        curatedPath: artifact?.path ?? null,
        declaredFormat: r.declared_format,
        detectedFormat: r.detected_format,
        schema: artifact ? JSON.parse(artifact.schema_json) : null,
        transformRules: artifact ? (JSON.parse(artifact.transform_rules_json) as unknown[]) : [],
        freshness: {
          lastSyncedAt: r.last_synced_at,
          sourceLastModified: r.last_modified,
          sourceEtagOrHash: r.etag,
          isStale: isStale(r.last_synced_at),
          freshnessSloSeconds,
        },
      };
    }),
    entities: entitiesRepo.listAttachments(datasetId).map((att) => {
      const ent = entitiesRepo.get(att.entity_id);
      return {
        entityId: att.entity_id,
        kind: ent?.kind ?? 'tag',
        label: { bg: ent?.canonical_label_bg ?? '', en: ent?.canonical_label_en ?? null },
        extractor: att.extractor,
        confidence: att.confidence,
      };
    }),
    links: linksRepo.forDataset(datasetId).map((l) => ({
      otherDatasetId: l.dataset_a_id === datasetId ? l.dataset_b_id : l.dataset_a_id,
      viaEntityId: l.via_entity_id,
      heuristic: l.heuristic,
      confidence: l.confidence,
    })),
  };
}
