import { useEffect, useState } from 'react';
import { buildUrl } from '../lib/api.ts';
import { bilingualLabel, freshnessDisplay } from '../lib/format.ts';
import type { FreshnessBlock } from '../types.ts';

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

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(false);
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
    <section>
      <button type="button" onClick={onClose}>
        ← обратно
      </button>
      {error && <p className="error">Грешка при зареждане на набора.</p>}
      {detail && (
        <article>
          <h2>{bilingualLabel(detail.titleBg, detail.titleEn, 'bg')}</h2>
          <p>{detail.descriptionBg}</p>
          <p>
            <span className={freshnessDisplay(detail.freshness).isStale ? 'stale' : undefined}>
              {freshnessDisplay(detail.freshness).label}
            </span>
          </p>
          <p>Тагове: {detail.tags.join(', ') || '—'}</p>
          <h3>Ресурси</h3>
          <ul>
            {detail.resources.map((r) => (
              <li key={r.resourceId}>
                {r.name ?? r.resourceId} ({r.kind ?? 'неизвестен'})
              </li>
            ))}
          </ul>
          <a href={detail.sourceUrl} target="_blank" rel="noreferrer">
            Източник: data.egov.bg ↗
          </a>
        </article>
      )}
    </section>
  );
}
