import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import oblastsRaw from '../../../packages/geo-boundaries/data/oblasts.geojson?raw';
import { ChatPanel } from './chat/ChatPanel.tsx';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { Button } from './components/ui/button.tsx';
import { DatasetDetail } from './datasets/DatasetDetail.tsx';
import { DatasetList } from './datasets/DatasetList.tsx';
import { ResourceReader } from './datasets/ResourceReader.tsx';
import { FilterPanel } from './filters/FilterPanel.tsx';
import { SearchBar } from './filters/SearchBar.tsx';
import { fetchDatasets, fetchNational, fetchRegions } from './lib/api.ts';
import type { BoundaryCollection } from './lib/choropleth.ts';
import { hasMore, mergePage } from './lib/pagination.ts';
import { type Theme, applyResolvedTheme, loadTheme, resolveTheme, saveTheme } from './lib/theme.ts';
import { MapErrorBoundary } from './map/MapErrorBoundary.tsx';
import { MapView } from './map/MapView.tsx';
import { useExplorer } from './store/explorerStore.ts';
import type { DatasetPointer, RegionSummary } from './types.ts';

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setDark(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return dark;
}

export function App() {
  const filters = useExplorer((s) => s.filters);
  const highlight = useExplorer((s) => s.highlight);
  const selectRegion = useExplorer((s) => s.selectRegion);
  const selectedRegionId = useExplorer((s) => s.selectedRegionId);

  const [theme, setThemeState] = useState<Theme>(() => loadTheme(localStorage));
  const prefersDark = usePrefersDark();
  const resolved = resolveTheme(theme, prefersDark);
  useEffect(() => {
    applyResolvedTheme(document.documentElement, resolved);
  }, [resolved]);
  function setTheme(next: Theme) {
    setThemeState(next);
    saveTheme(localStorage, next);
  }

  const [regions, setRegions] = useState<RegionSummary[]>([]);
  const [datasets, setDatasets] = useState<DatasetPointer[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNational, setShowNational] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const boundaries = useMemo(() => JSON.parse(oblastsRaw) as BoundaryCollection, []);
  const geoLabel = useMemo(() => {
    const m = new Map(
      regions.filter((r) => r.entityId).map((r) => [r.entityId as string, r.labelBg]),
    );
    return (id: string) => m.get(id) ?? id;
  }, [regions]);
  const PAGE = 50;
  const loader = showNational ? fetchNational : fetchDatasets;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
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
      <header className="flex items-center gap-3 bg-primary px-5 py-2 text-primary-foreground">
        <h1 className="text-base font-semibold tracking-tight">danni.bg</h1>
        <span className="text-xs opacity-80">
          Интерактивна карта на отворените данни на България
        </span>
        <div className="ml-auto">
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </header>
      <div className="flex min-h-0">
        <aside
          className="shrink-0 overflow-hidden border-r bg-card transition-[width] duration-200 ease-in-out"
          style={{ width: leftOpen ? 340 : 0 }}
        >
          <div className="h-full w-[340px] space-y-3 overflow-y-auto p-4">
            <SearchBar loading={loading} />
            <FilterPanel geoLabel={geoLabel} />
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
          </div>
        </aside>
        <main className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-label={leftOpen ? 'Скрий филтрите' : 'Покажи филтрите'}
            onClick={() => setLeftOpen((v) => !v)}
            className="-translate-y-1/2 absolute top-1/2 left-2 z-10 flex h-12 w-6 items-center justify-center rounded-md border bg-card/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground"
          >
            {leftOpen ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <button
            type="button"
            aria-label={rightOpen ? 'Скрий чата' : 'Покажи чата'}
            onClick={() => setRightOpen((v) => !v)}
            className="-translate-y-1/2 absolute top-1/2 right-2 z-10 flex h-12 w-6 items-center justify-center rounded-md border bg-card/90 text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground"
          >
            {rightOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
          <MapErrorBoundary>
            <MapView
              boundaries={boundaries}
              regions={regions}
              highlightGeoIds={highlight.geoEntityIds}
              selectedGeoId={selectedRegionId}
              onSelect={selectRegion}
              isDark={resolved === 'dark'}
            />
          </MapErrorBoundary>
          {/* Centre document reader — overlays the map when a resource is opened. */}
          <ResourceReader />
        </main>
        <aside
          className="shrink-0 overflow-hidden border-l bg-card transition-[width] duration-200 ease-in-out"
          style={{ width: rightOpen ? 380 : 0 }}
        >
          <div className="h-full w-[380px] p-4">
            <ChatPanel onSelectDataset={setSelectedDataset} />
          </div>
        </aside>
      </div>
    </div>
  );
}
