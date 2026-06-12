import { ArrowLeft } from 'lucide-react';
import { useExplorer } from '../store/explorerStore.ts';
import { ResourcePreview } from './ResourcePreview.tsx';

/**
 * The centre document reader: renders the opened resource's data full-size in place of the map, so
 * the data is read where there's room — not crammed into the side panel. Driven by the store's
 * `reader` target; returns null (map stays) when nothing is open.
 */
export function ResourceReader() {
  const reader = useExplorer((s) => s.reader);
  const closeReader = useExplorer((s) => s.closeReader);
  if (!reader) return null;

  return (
    // Overlays the map (kept mounted underneath, so closing is instant with no re-init flash).
    <div className="absolute inset-0 z-[5] flex flex-col gap-2 bg-background p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={closeReader}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-2 py-1 hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft className="size-3.5" /> Карта
        </button>
        <span className="truncate" title={reader.titleBg}>
          {reader.titleBg}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ResourcePreview
          variant="reader"
          datasetId={reader.datasetId}
          resourceId={reader.resourceId}
          name={reader.name}
          onClose={closeReader}
        />
      </div>
    </div>
  );
}
