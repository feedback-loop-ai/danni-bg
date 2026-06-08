import { useEffect, useMemo, useState } from 'react';
import oblastsRaw from '../../../packages/geo-boundaries/data/oblasts.geojson?raw';
import { ChatPanel } from './chat/ChatPanel.tsx';
import { Button } from './components/ui/button.tsx';
import { DatasetDetail } from './datasets/DatasetDetail.tsx';
import { DatasetList } from './datasets/DatasetList.tsx';
import { FilterPanel } from './filters/FilterPanel.tsx';
import { fetchDatasets, fetchNational, fetchRegions } from './lib/api.ts';
import type { BoundaryCollection } from './lib/choropleth.ts';
import { hasMore, mergePage } from './lib/pagination.ts';
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
  const [total, setTotal] = useState(0);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [showNational, setShowNational] = useState(false);

  const boundaries = useMemo(() => JSON.parse(oblastsRaw) as BoundaryCollection, []);
  const PAGE = 50;
  const loader = showNational ? fetchNational : fetchDatasets;

  useEffect(() => {
    let cancelled = false;
    fetchRegions(filters, 'oblast')
      .then((r) => {
        if (!cancelled) setRegions(r.regions);
      })
      .catch(() => undefined);
    loader(filters, PAGE, 0)
      .then((r) => {
        if (!cancelled) {
          setDatasets(r.datasets);
          setTotal(r.total);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filters, loader]);

  function loadMore() {
    loader(filters, PAGE, datasets.length)
      .then((r) => {
        setDatasets((prev) => mergePage(prev, r.datasets));
        setTotal(r.total);
      })
      .catch(() => undefined);
  }

  return (
    <div className="grid h-screen grid-rows-[auto_1fr]">
      <header className="flex items-baseline gap-3 bg-primary px-5 py-2.5 text-primary-foreground">
        <h1 className="text-base font-semibold tracking-tight">danni.bg</h1>
        <span className="text-xs opacity-80">
          Интерактивна карта на отворените данни на България
        </span>
      </header>
      <div className="grid min-h-0 grid-cols-[340px_1fr_380px]">
        <aside className="space-y-3 overflow-y-auto border-r bg-card p-4">
          <FilterPanel />
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            aria-pressed={showNational}
            onClick={() => setShowNational((v) => !v)}
          >
            {showNational ? '← Към регионите' : 'Национални набори (без регион)'}
          </Button>
          {selectedDataset ? (
            <DatasetDetail datasetId={selectedDataset} onClose={() => setSelectedDataset(null)} />
          ) : (
            <DatasetList
              datasets={datasets}
              total={total}
              hasMore={hasMore(datasets.length, total)}
              onSelect={setSelectedDataset}
              onLoadMore={loadMore}
            />
          )}
        </aside>
        <main className="relative h-full min-w-0">
          <MapErrorBoundary>
            <MapView
              boundaries={boundaries}
              regions={regions}
              highlightGeoIds={highlight.geoEntityIds}
              onSelect={selectRegion}
            />
          </MapErrorBoundary>
        </main>
        <aside className="overflow-y-auto border-l bg-card p-4">
          <ChatPanel onSelectDataset={setSelectedDataset} />
        </aside>
      </div>
    </div>
  );
}
