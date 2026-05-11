import type { Database } from 'bun:sqlite';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import { EntitiesRepo } from '../store/repos/entities.ts';
import { OrganizationsRepo } from '../store/repos/organizations.ts';
import { TranslationsRepo } from '../store/repos/translations.ts';
import type { Embedder } from './embedder.ts';
import { listEmbeddings } from './embeddings-store.ts';

export type Lang = 'bg' | 'en' | 'auto';

export interface IndexEntry {
  datasetId: string;
  score: number;
  matchKind: 'keyword' | 'semantic' | 'hybrid' | 'entity';
  title: {
    bg: string;
    en: string | null;
    translator: string | null;
    translationConfidence: number | null;
  };
  snippet?: string | null;
  publisher: {
    id: string;
    title: {
      bg: string;
      en: string | null;
      translator: string | null;
      translationConfidence: number | null;
    };
  } | null;
  matchedEntities?: Array<{
    entityId: string;
    kind: string;
    label: { bg: string; en: string | null };
  }>;
  sourceUrl: string;
  curatedDatasetPath: string;
  freshness: {
    lastSyncedAt: string;
    sourceLastModified: string | null;
    sourceEtagOrHash: string | null;
    isStale: boolean;
    freshnessSloSeconds: number;
  };
}

export interface QueryOptions {
  db: Database;
  embedder: Embedder;
  query: string;
  lang?: Lang;
  limit?: number;
  freshnessSloSeconds?: number;
}

function escapeFts(query: string): string {
  // FTS5 strips problematic chars; double-quote each token to avoid syntax errors.
  return query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const mag = Math.sqrt(na) * Math.sqrt(nb);
  return mag === 0 ? 0 : dot / mag;
}

interface ScoredCandidate {
  datasetId: string;
  ftsRank?: number | undefined;
  vecRank?: number | undefined;
}

const RRF_K = 60;

export async function search(opts: QueryOptions): Promise<IndexEntry[]> {
  const limit = opts.limit ?? 5;
  const sloSeconds = opts.freshnessSloSeconds ?? 86400;

  const ftsResults = opts.db
    .query<{ dataset_id: string }, [string]>(
      'SELECT dataset_id FROM datasets_fts WHERE datasets_fts MATCH ? ORDER BY rank LIMIT 50',
    )
    .all(escapeFts(opts.query));

  const ftsRanks = new Map<string, number>();
  ftsResults.forEach((r, i) => ftsRanks.set(r.dataset_id, i + 1));

  const vecCandidates = listEmbeddings(opts.db);
  const vecRanks = new Map<string, number>();
  if (vecCandidates.length > 0) {
    const [queryVec] = await opts.embedder.embed([opts.query]);
    if (queryVec) {
      const scored = vecCandidates.map((c) => ({
        datasetId: c.dataset_id,
        score: cosine(queryVec, c.vector),
      }));
      scored.sort((a, b) => b.score - a.score);
      scored.slice(0, 50).forEach((s, i) => vecRanks.set(s.datasetId, i + 1));
    }
  }

  const candidates = new Map<string, ScoredCandidate>();
  for (const id of ftsRanks.keys())
    candidates.set(id, { datasetId: id, ftsRank: ftsRanks.get(id) });
  for (const id of vecRanks.keys()) {
    const c = candidates.get(id) ?? { datasetId: id };
    c.vecRank = vecRanks.get(id);
    candidates.set(id, c);
  }

  const scored = [...candidates.values()].map((c) => {
    const ftsScore = c.ftsRank ? 1 / (RRF_K + c.ftsRank) : 0;
    const vecScore = c.vecRank ? 1 / (RRF_K + c.vecRank) : 0;
    return { datasetId: c.datasetId, score: ftsScore + vecScore, c };
  });
  scored.sort((a, b) => b.score - a.score);

  const winners = scored.slice(0, limit);
  const datasets = new DatasetsRepo(opts.db);
  const orgs = new OrganizationsRepo(opts.db);
  const translations = new TranslationsRepo(opts.db);

  const out: IndexEntry[] = [];
  for (const { datasetId, score, c } of winners) {
    const ds = datasets.get(datasetId);
    if (!ds) continue;
    const titleTx = translations.forSubject('dataset_title', datasetId)[0];
    const org = ds.publisher_id ? orgs.get(ds.publisher_id) : null;
    const orgTitleTx = org
      ? translations.forSubject('entity_label', `org:${org.id}`)[0]
      : undefined;

    let matchKind: IndexEntry['matchKind'] = 'hybrid';
    if (c.ftsRank && !c.vecRank) matchKind = 'keyword';
    else if (!c.ftsRank && c.vecRank) matchKind = 'semantic';
    out.push({
      datasetId,
      score,
      matchKind,
      title: {
        bg: ds.title_bg,
        en: titleTx?.text_en ?? null,
        translator: titleTx?.translator ?? null,
        translationConfidence: titleTx?.confidence ?? null,
      },
      snippet: null,
      publisher: org
        ? {
            id: org.id,
            title: {
              bg: org.title_bg,
              en: orgTitleTx?.text_en ?? null,
              translator: orgTitleTx?.translator ?? null,
              translationConfidence: orgTitleTx?.confidence ?? null,
            },
          }
        : null,
      sourceUrl: ds.source_url,
      curatedDatasetPath: `${ds.id}`,
      freshness: {
        lastSyncedAt: ds.last_synced_at,
        sourceLastModified: ds.metadata_modified,
        sourceEtagOrHash: ds.source_etag_or_hash,
        isStale: (Date.now() - new Date(ds.last_synced_at).getTime()) / 1000 > sloSeconds,
        freshnessSloSeconds: sloSeconds,
      },
    });
  }
  return out;
}

export async function searchByEntity(opts: QueryOptions, entityId: string): Promise<IndexEntry[]> {
  const limit = opts.limit ?? 50;
  const sloSeconds = opts.freshnessSloSeconds ?? 86400;
  const datasetIds = new EntitiesRepo(opts.db).datasetsForEntity(entityId);
  const datasets = new DatasetsRepo(opts.db);
  const out: IndexEntry[] = [];
  for (const id of datasetIds.slice(0, limit)) {
    const ds = datasets.get(id);
    if (!ds) continue;
    out.push({
      datasetId: id,
      score: 1.0,
      matchKind: 'entity',
      title: { bg: ds.title_bg, en: null, translator: null, translationConfidence: null },
      snippet: null,
      publisher: null,
      matchedEntities: [{ entityId, kind: 'unknown', label: { bg: '', en: null } }],
      sourceUrl: ds.source_url,
      curatedDatasetPath: `${id}`,
      freshness: {
        lastSyncedAt: ds.last_synced_at,
        sourceLastModified: ds.metadata_modified,
        sourceEtagOrHash: ds.source_etag_or_hash,
        isStale: (Date.now() - new Date(ds.last_synced_at).getTime()) / 1000 > sloSeconds,
        freshnessSloSeconds: sloSeconds,
      },
    });
  }
  return out;
}
