// Shared explorer state (T017): the single FilterState plus map selection and the chat/map highlight
// anchor. Map selection and geoUnit filters are kept mutually consistent (FR-009/FR-014); clearing
// filters expands the chat scope back to the full mirror (FR-028). Built on zustand/vanilla so the
// state logic is unit-testable without React; components subscribe via the useExplorer hook.

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { EMPTY_FILTERS, type FilterState, type MapAnchor } from '../types.ts';
import { clearAll } from '../lib/filters.ts';

/** A single dataset the chat is focused on ("ask about this dataset"); scopes chat retrieval to it. */
export interface ChatFocus {
  datasetId: string;
  titleBg: string;
}

/** The resource opened in the centre document reader (replaces the map while set). */
export interface ReaderTarget {
  datasetId: string;
  resourceId: string;
  name: string;
  /** Parent dataset title, shown as the reader's breadcrumb. */
  titleBg: string;
}

export interface ExplorerState {
  filters: FilterState;
  selectedRegionId: string | null;
  highlight: MapAnchor;
  chatFocus: ChatFocus | null;
  reader: ReaderTarget | null;
  setFilters: (f: FilterState) => void;
  updateFilters: (fn: (f: FilterState) => FilterState) => void;
  clearFilters: () => void;
  selectRegion: (entityId: string | null) => void;
  setHighlight: (anchor: MapAnchor) => void;
  setChatFocus: (focus: ChatFocus | null) => void;
  openReader: (target: ReaderTarget) => void;
  closeReader: () => void;
}

const NO_HIGHLIGHT: MapAnchor = { geoEntityIds: [], datasetIds: [] };

export const explorerStore = createStore<ExplorerState>((set) => ({
  filters: { ...EMPTY_FILTERS },
  selectedRegionId: null,
  highlight: NO_HIGHLIGHT,
  chatFocus: null,
  reader: null,
  setFilters: (filters) => set({ filters }),
  updateFilters: (fn) => set((s) => ({ filters: fn(s.filters) })),
  clearFilters: () => set({ filters: clearAll(), highlight: NO_HIGHLIGHT }),
  // Selecting a region also constrains the geo filter so map and lists stay consistent (FR-009).
  selectRegion: (entityId) =>
    set((s) => ({
      selectedRegionId: entityId,
      filters: { ...s.filters, geoUnitIds: entityId ? [entityId] : [] },
    })),
  setHighlight: (highlight) => set({ highlight }),
  setChatFocus: (chatFocus) => set({ chatFocus }),
  openReader: (reader) => set({ reader }),
  closeReader: () => set({ reader: null }),
}));

export function useExplorer<T>(selector: (s: ExplorerState) => T): T {
  return useStore(explorerStore, selector);
}
