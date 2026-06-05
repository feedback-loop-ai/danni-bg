import { useEffect, useMemo, useState } from 'react';
import oblastsRaw from '../../../packages/geo-boundaries/data/oblasts.geojson?raw';
import { ChatPanel } from './chat/ChatPanel.tsx';
import { DatasetDetail } from './datasets/DatasetDetail.tsx';
import { DatasetList } from './datasets/DatasetList.tsx';
import { FilterPanel } from './filters/FilterPanel.tsx';
import { fetchDatasets, fetchNational, fetchRegions } from './lib/api.ts';
import type { BoundaryCollection } from './lib/choropleth.ts';
import { MapErrorBoundary } from './map/MapErrorBoundary.tsx';
import { MapView } from './map/MapView.tsx';
import { useExplorer } from './store/explorerStore.ts';
import type { DatasetPointer, RegionSummary } from './types.ts';

export function App() {
  const filters = useExplorer((s) => s.filters);
  const highlight = useExplorer((s) => s.highlight);
  const selectRegion = useExplorer((s) => s.selectRegion);

  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [datasets, setDatasets] = useState<DatasetPointer[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [showNational, setShowNational] = useState(false);

  const boundaries = useMemo(() => JSON.parse(oblastsRaw) as BoundaryCollection, []);

  useEffect(() => {
    let cancelled = false;
    fetchRegions(filters, 'oblast')
      .then((r) => {
        if (!cancelled) setRegions(r.regions);
      })
      .catch(() => undefined);
    const load = showNational ? fetchNational(filters, 50, 0) : fetchDatasets(filters, 50, 0);
    load
      .then((r) => {
        if (!cancelled) setDatasets(r.datasets);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filters, showNational]);

  return (
    <div className="app">
      <aside className="panel">
        <FilterPanel />
        <button
          type="button"
          aria-pressed={showNational}
          onClick={() => setShowNational((v) => !v)}
        >
          {showNational ? '← Към регионите' : 'Национални набори (без регион)'}
        </button>
        {selectedDataset ? (
          <DatasetDetail datasetId={selectedDataset} onClose={() => setSelectedDataset(null)} />
        ) : (
          <DatasetList datasets={datasets} onSelect={setSelectedDataset} />
        )}
      </aside>
      <main className="map">
        <MapErrorBoundary>
          <MapView
            boundaries={boundaries}
            regions={regions}
            highlightGeoIds={highlight.geoEntityIds}
            onSelect={selectRegion}
          />
        </MapErrorBoundary>
      </main>
      <aside className="panel">
        <ChatPanel onSelectDataset={setSelectedDataset} />
      </aside>
    </div>
  );
}
