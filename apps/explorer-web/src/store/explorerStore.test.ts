import { beforeEach, describe, expect, it } from 'bun:test';
import { EMPTY_FILTERS } from '../types.ts';
import { explorerStore } from './explorerStore.ts';

describe('explorerStore', () => {
  beforeEach(() => {
    explorerStore.setState({
      filters: { ...EMPTY_FILTERS },
      selectedRegionId: null,
      highlight: { geoEntityIds: [], datasetIds: [] },
    });
  });

  it('updateFilters applies an immutable transform', () => {
    explorerStore.getState().updateFilters((f) => ({ ...f, tags: ['въздух'] }));
    expect(explorerStore.getState().filters.tags).toEqual(['въздух']);
  });

  it('selectRegion syncs the geo filter (FR-009) and clears on null', () => {
    explorerStore.getState().selectRegion('geo:bg-oblast-ruse');
    expect(explorerStore.getState().selectedRegionId).toBe('geo:bg-oblast-ruse');
    expect(explorerStore.getState().filters.geoUnitIds).toEqual(['geo:bg-oblast-ruse']);
    explorerStore.getState().selectRegion(null);
    expect(explorerStore.getState().filters.geoUnitIds).toEqual([]);
  });

  it('setHighlight stores the anchor; clearFilters resets filters + highlight (FR-028)', () => {
    explorerStore.getState().setHighlight({ geoEntityIds: ['geo:bg-oblast-ruse'], datasetIds: ['d1'] });
    expect(explorerStore.getState().highlight.datasetIds).toEqual(['d1']);
    explorerStore.getState().updateFilters((f) => ({ ...f, tags: ['x'] }));
    explorerStore.getState().clearFilters();
    expect(explorerStore.getState().filters).toEqual(EMPTY_FILTERS);
    expect(explorerStore.getState().highlight.geoEntityIds).toEqual([]);
  });

  it('setFilters replaces the whole filter object', () => {
    explorerStore.getState().setFilters({ ...EMPTY_FILTERS, freshness: 'stale' });
    expect(explorerStore.getState().filters.freshness).toBe('stale');
  });
});
