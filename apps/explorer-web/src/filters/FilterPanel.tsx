import { useState } from 'react';
import { removeChip, setFreshness, toChips, toggleValue } from '../lib/filters.ts';
import { useExplorer } from '../store/explorerStore.ts';
import type { FreshnessFilter } from '../types.ts';

const FRESHNESS: FreshnessFilter[] = ['any', 'fresh', 'stale'];

export function FilterPanel() {
  const filters = useExplorer((s) => s.filters);
  const updateFilters = useExplorer((s) => s.updateFilters);
  const clearFilters = useExplorer((s) => s.clearFilters);
  const [tag, setTag] = useState('');

  const chips = toChips(filters);

  return (
    <section>
      <h2>Филтри</h2>
      <input
        aria-label="Свободно търсене"
        placeholder="търсене…"
        value={filters.query}
        onChange={(e) => updateFilters((f) => ({ ...f, query: e.target.value }))}
      />
      <div>
        <input
          aria-label="Добави таг"
          placeholder="таг"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            if (tag.trim()) updateFilters((f) => toggleValue(f, 'tags', tag.trim()));
            setTag('');
          }}
        >
          Добави таг
        </button>
      </div>
      <label>
        Актуалност:{' '}
        <select
          value={filters.freshness}
          onChange={(e) => updateFilters((f) => setFreshness(f, e.target.value as FreshnessFilter))}
        >
          {FRESHNESS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={filters.includeWithdrawn}
          onChange={(e) => updateFilters((f) => ({ ...f, includeWithdrawn: e.target.checked }))}
        />
        вкл. оттеглени
      </label>
      <div>
        {chips.map((chip) => (
          <span className="chip" key={`${chip.kind}:${chip.value}`}>
            {chip.label}
            <button
              type="button"
              aria-label={`Премахни ${chip.label}`}
              onClick={() => updateFilters((f) => removeChip(f, chip))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {chips.length > 0 && (
        <button type="button" onClick={() => clearFilters()}>
          Изчисти всички
        </button>
      )}
    </section>
  );
}
