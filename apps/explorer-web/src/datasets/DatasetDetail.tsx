import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { buildUrl } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { bilingualLabel, freshnessDisplay } from '../lib/format.ts';
import { useExplorer } from '../store/explorerStore.ts';
import type { FreshnessBlock } from '../types.ts';
import { ResourcePreview } from './ResourcePreview.tsx';

interface DetailView {
  datasetId: string;
  titleBg: string;
  titleEn: string | null;
  descriptionBg: string;
  tags: string[];
  freshness: FreshnessBlock;
  sourceUrl: string;
  resources: { resourceId: string; name: string | null; kind: string | null }[];
}

interface DatasetDetailProps {
  datasetId: string;
  onClose: () => void;
}

export function DatasetDetail({ datasetId, onClose }: DatasetDetailProps) {
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [error, setError] = useState(false);
  const [openResource, setOpenResource] = useState<{ id: string; name: string } | null>(null);
  const setChatFocus = useExplorer((s) => s.setChatFocus);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(false);
    setOpenResource(null);
    fetch(buildUrl(`/api/datasets/${encodeURIComponent(datasetId)}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((d: DetailView) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  return (
    <section className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onClose}>
        ← обратно
      </Button>
      {error && <p className="text-sm text-destructive">Грешка при зареждане на набора.</p>}
      {detail && (
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold leading-snug">
            {bilingualLabel(detail.titleBg, detail.titleEn, 'bg')}
          </h2>
          <p className="text-sm text-muted-foreground">{detail.descriptionBg}</p>
          <p className="text-sm">
            <span className={cn(freshnessDisplay(detail.freshness).isStale && 'text-warning')}>
              {freshnessDisplay(detail.freshness).label}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">Тагове: {detail.tags.join(', ') || '—'}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setChatFocus({ datasetId: detail.datasetId, titleBg: detail.titleBg })}
          >
            Питай чата за този набор
          </Button>
          <h3 className="pt-1 text-sm font-semibold">Ресурси</h3>
          <ul className="space-y-1">
            {detail.resources.map((r) => {
              const label = r.name ?? r.resourceId;
              return (
                <li key={r.resourceId}>
                  <button
                    type="button"
                    onClick={() => setOpenResource({ id: r.resourceId, name: label })}
                    className={cn(
                      'w-full rounded-md border px-2 py-1.5 text-left text-sm transition-colors hover:border-primary hover:bg-accent/40',
                      openResource?.id === r.resourceId && 'border-primary bg-accent/40',
                    )}
                  >
                    {label}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({r.kind ?? 'неизвестен'})
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {openResource && (
            <ResourcePreview
              datasetId={datasetId}
              resourceId={openResource.id}
              name={openResource.name}
              onClose={() => setOpenResource(null)}
            />
          )}
          <a
            className="inline-block text-sm text-primary underline-offset-4 hover:underline"
            href={detail.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Източник: data.egov.bg ↗
          </a>
        </Card>
      )}
    </section>
  );
}
