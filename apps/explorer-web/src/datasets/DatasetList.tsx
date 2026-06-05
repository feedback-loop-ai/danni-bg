import { bilingualLabel, freshnessDisplay } from '../lib/format.ts';
import type { DatasetPointer } from '../types.ts';

interface DatasetListProps {
  datasets: DatasetPointer[];
  onSelect: (datasetId: string) => void;
}

export function DatasetList({ datasets, onSelect }: DatasetListProps) {
  if (datasets.length === 0) {
    return <p>Няма набори от данни за текущия изглед.</p>;
  }
  return (
    <section>
      <h2>Набори от данни ({datasets.length})</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {datasets.map((d) => {
          const fresh = freshnessDisplay(d.freshness);
          return (
            <li key={d.datasetId}>
              <button type="button" className="dataset-row" onClick={() => onSelect(d.datasetId)}>
                <strong>{bilingualLabel(d.titleBg, d.titleEn, 'bg')}</strong>
                <br />
                <small>
                  {d.publisher?.titleBg ?? 'без издател'} ·{' '}
                  <span className={fresh.isStale ? 'stale' : undefined}>{fresh.label}</span>
                </small>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
