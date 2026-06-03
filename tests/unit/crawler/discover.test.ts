import { describe, expect, it } from 'bun:test';
import type { CkanClient } from '../../../src/crawler/ckan-client.ts';
import { discoverDatasets } from '../../../src/crawler/discover.ts';
import { buildScopePredicate } from '../../../src/crawler/scope.ts';

function makeClient(pages: unknown[]): CkanClient {
  let i = 0;
  return {
    packageSearch: async () => {
      const page = pages[i++] ?? { result: { count: 0, results: [] } };
      return page as never;
    },
  } as unknown as CkanClient;
}

describe('crawler.discover', () => {
  it('paginates and yields summaries that pass the scope filter', async () => {
    const client = makeClient([
      {
        result: {
          count: 3,
          results: [
            {
              id: 'd1',
              name: 'one',
              tags: [{ name: 'x' }],
              groups: [],
              organization: { id: 'p1' },
            },
            { id: 'd2', name: 'two', tags: [], groups: [], organization: { id: 'p2' } },
          ],
        },
      },
      {
        result: {
          count: 3,
          results: [{ id: 'd3', name: 'three', tags: [], groups: [], organization: { id: 'p1' } }],
        },
      },
      { result: { count: 3, results: [] } },
    ]);
    const predicate = buildScopePredicate({ publishers: ['p1'] });
    const ids: string[] = [];
    for await (const s of discoverDatasets({ client, scopePredicate: predicate, pageSize: 2 })) {
      ids.push(s.id);
    }
    expect(ids).toEqual(['d1', 'd3']);
  });

  it('terminates on empty page', async () => {
    const client = makeClient([{ result: { count: 0, results: [] } }]);
    const seen: string[] = [];
    for await (const s of discoverDatasets({
      client,
      scopePredicate: () => true,
      pageSize: 100,
    })) {
      seen.push(s.id);
    }
    expect(seen.length).toBe(0);
  });
});
