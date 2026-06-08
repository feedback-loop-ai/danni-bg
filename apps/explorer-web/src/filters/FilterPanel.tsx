import { useState } from 'react';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
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
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Филтри
      </h2>
      <Input
        aria-label="Свободно търсене"
        placeholder="търсене…"
        value={filters.query}
        onChange={(e) => updateFilters((f) => ({ ...f, query: e.target.value }))}
      />
      <div className="flex gap-2">
        <Input
          aria-label="Добави таг"
          placeholder="таг"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <Button
          variant="secondary"
          onClick={() => {
            if (tag.trim()) updateFilters((f) => toggleValue(f, 'tags', tag.trim()));
            setTag('');
          }}
        >
          Добави таг
        </Button>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <label className="flex items-center gap-2">
          Актуалност:
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={filters.freshness}
            onChange={(e) =>
              updateFilters((f) => setFreshness(f, e.target.value as FreshnessFilter))
            }
          >
            {FRESHNESS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            checked={filters.includeWithdrawn}
            onChange={(e) => updateFilters((f) => ({ ...f, includeWithdrawn: e.target.checked }))}
          />
          вкл. оттеглени
        </label>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <Badge key={`${chip.kind}:${chip.value}`}>
              {chip.label}
              <button
                type="button"
                aria-label={`Премахни ${chip.label}`}
                className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-primary/15 leading-none hover:bg-primary/25"
                onClick={() => updateFilters((f) => removeChip(f, chip))}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => clearFilters()}>
          Изчисти всички
        </Button>
      )}
    </section>
  );
}
