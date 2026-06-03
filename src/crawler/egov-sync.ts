import type { Database } from 'bun:sqlite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir } from '../lib/fs.ts';
import { sha256Hex } from '../lib/hash.ts';
import { withContext } from '../logging/logger.ts';
import { DatasetsRepo } from '../store/repos/datasets.ts';
import { OrganizationsRepo } from '../store/repos/organizations.ts';
import { ResourcesRepo } from '../store/repos/resources.ts';
import type { EgovBgClient } from './egov-bg-client.ts';

export interface EgovSyncOptions {
  db: Database;
  storeRoot: string;
  client: EgovBgClient;
  /** Explicit dataset URIs to pull (from scope.datasetIds). */
  datasetUris?: string[];
  /** Cap when enumerating the whole portal (ignored when datasetUris given). */
  maxDatasets?: number;
  locale?: string;
}

export interface EgovSyncResult {
  datasets: number;
  resources: number;
  captured: number;
  failures: number;
}

const MAX_ORG_PAGES = 12;
const PAGE_SIZE = 100;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'item'
  );
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize datastore rows (array-of-arrays, header first) to CSV bytes. */
export function rowsToCsv(rows: unknown[]): string {
  return `${rows.map((r) => (Array.isArray(r) ? r.map(csvCell).join(',') : csvCell(r))).join('\n')}\n`;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Discover datasets from data.egov.bg's custom API and capture each resource's
 * datastore content into the store so the existing curate→enrich→index pipeline
 * can run over real portal data. Off-portal file fetching (resource_url) reuses
 * the CKAN download path and is out of scope here.
 */
export async function runEgovSync(opts: EgovSyncOptions): Promise<EgovSyncResult> {
  const log = withContext({ component: 'egov-sync' });
  const datasetsRepo = new DatasetsRepo(opts.db);
  const resourcesRepo = new ResourcesRepo(opts.db);
  const orgsRepo = new OrganizationsRepo(opts.db);
  const locale = opts.locale ?? 'bg';

  const orgCache = new Map<number, { uri: string; name: string }>();
  let orgPagesLoaded = 0;
  const resolveOrg = async (orgId: number | null | undefined): Promise<string | null> => {
    if (orgId === null || orgId === undefined) return null;
    while (!orgCache.has(orgId) && orgPagesLoaded < MAX_ORG_PAGES) {
      const page = orgPagesLoaded + 1;
      const resp = await opts.client.listOrganisations({
        recordsPerPage: PAGE_SIZE,
        pageNumber: page,
      });
      for (const o of resp.organisations) {
        if (typeof o.id === 'number') orgCache.set(o.id, { uri: o.uri, name: o.name });
      }
      orgPagesLoaded = page;
      if (resp.organisations.length < PAGE_SIZE) break;
    }
    const found = orgCache.get(orgId);
    const id = `egov-org-${orgId}`;
    orgsRepo.upsert({
      id,
      slug: found ? slugify(found.name) : id,
      titleBg: found ? found.name : `Организация ${orgId}`,
      sourceUrl: found
        ? `https://data.egov.bg/organisation/profile/${found.uri}`
        : 'https://data.egov.bg/',
    });
    return id;
  };

  let uris: string[];
  if (opts.datasetUris && opts.datasetUris.length > 0) {
    uris = opts.datasetUris;
  } else {
    uris = [];
    const cap = opts.maxDatasets ?? 50;
    let page = 1;
    while (uris.length < cap) {
      const resp = await opts.client.listDatasets({ recordsPerPage: PAGE_SIZE, pageNumber: page });
      for (const d of resp.datasets) {
        uris.push(d.uri);
        if (uris.length >= cap) break;
      }
      if (resp.datasets.length < PAGE_SIZE) break;
      page++;
    }
  }

  let datasets = 0;
  let resources = 0;
  let captured = 0;
  let failures = 0;

  for (const uri of uris) {
    let details: Awaited<ReturnType<EgovBgClient['getDatasetDetails']>>;
    try {
      details = await opts.client.getDatasetDetails(uri, locale);
    } catch (err) {
      log.warn('egov.dataset.skip', { uri, error: msg(err) });
      failures++;
      continue;
    }
    const d = details.data;
    const publisherId = await resolveOrg(d.org_id);
    datasetsRepo.upsert({
      id: d.uri,
      slug: slugify(d.name),
      titleBg: d.name,
      // The portal returns `descript: 0` (number) for an empty description.
      descriptionBg: typeof d.descript === 'string' && d.descript.length > 0 ? d.descript : null,
      publisherId,
      tags: (d.tags ?? []).map((t) => t.name),
      groups: [],
      sourceUrl: `https://data.egov.bg/data/view/${d.uri}`,
    });
    datasets++;

    let resList: Awaited<ReturnType<EgovBgClient['listResources']>>;
    try {
      resList = await opts.client.listResources(d.uri);
    } catch (err) {
      log.warn('egov.resources.skip', { uri, error: msg(err) });
      continue;
    }

    for (const r of resList.resources) {
      resources++;
      const formatHint = r.file_format ? r.file_format.toLowerCase() : null;
      const baseResource = {
        id: r.uri,
        datasetId: d.uri,
        sourceUrl: r.resource_url || `https://data.egov.bg/data/view/${d.uri}`,
        name: r.name ?? null,
      };
      let rows: unknown[];
      try {
        rows = (await opts.client.getResourceData(r.uri)).data;
      } catch (err) {
        log.warn('egov.capture.fail', { resource: r.uri, error: msg(err) });
        resourcesRepo.upsert({ ...baseResource, declaredFormat: formatHint });
        resourcesRepo.recordOutcome(r.uri, 'failure', msg(err));
        failures++;
        continue;
      }
      if (rows.length === 0) {
        resourcesRepo.upsert({ ...baseResource, declaredFormat: formatHint });
        resourcesRepo.recordOutcome(r.uri, 'failure', 'empty datastore');
        failures++;
        continue;
      }
      // The serialized shape — not the portal's file_format — is authoritative for
      // curator selection: array-of-arrays → CSV (tabular), else JSON. Set
      // declared_format to what we actually wrote so the registry routes correctly.
      const ext = Array.isArray(rows[0]) ? 'csv' : 'json';
      const content = ext === 'csv' ? rowsToCsv(rows) : `${JSON.stringify(rows, null, 2)}\n`;
      const rawPath = join(d.uri, r.uri, `raw.${ext}`);
      ensureDir(join(opts.storeRoot, 'raw', d.uri, r.uri));
      writeFileSync(join(opts.storeRoot, 'raw', rawPath), content);
      const buf = Buffer.from(content, 'utf-8');
      resourcesRepo.upsert({ ...baseResource, declaredFormat: ext });
      resourcesRepo.recordCapture({
        id: r.uri,
        bytes: buf.byteLength,
        sha256: sha256Hex(buf),
        rawPath,
        detectedFormat: ext,
        outcome: 'success',
      });
      captured++;
    }
  }

  log.info('egov.completed', { datasets, resources, captured, failures });
  return { datasets, resources, captured, failures };
}
