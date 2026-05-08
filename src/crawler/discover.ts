import type { CkanClient } from './ckan-client.ts';
import type { DatasetSummary, ScopePredicate } from './scope.ts';

export interface DiscoverOptions {
  client: CkanClient;
  scopePredicate: ScopePredicate;
  pageSize?: number;
}

export async function* discoverDatasets(opts: DiscoverOptions): AsyncGenerator<DatasetSummary> {
  const pageSize = opts.pageSize ?? 100;
  let start = 0;
  for (;;) {
    const res = await opts.client.packageSearch({
      start,
      rows: pageSize,
      sort: 'metadata_modified desc',
    });
    const results = res.result.results;
    for (const pkg of results) {
      const summary: DatasetSummary = {
        id: pkg.id,
        slug: pkg.name,
        publisherId: pkg.organization?.id,
        groups: pkg.groups.map((g) => g.id),
        tags: pkg.tags.map((t) => t.name),
      };
      if (opts.scopePredicate(summary)) yield summary;
    }
    start += results.length;
    if (results.length === 0 || start >= res.result.count) break;
  }
}
