import { Input } from '../components/ui/input.tsx';
import type { ProviderConfig } from '../types.ts';

interface ProviderSettingsProps {
  provider: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
}

/** Provider configuration form. Visibility is controlled by the cogwheel in the chat header. */
export function ProviderSettings({ provider, onChange }: ProviderSettingsProps) {
  return (
    <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
      <label className="flex items-center gap-2 text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={provider.useServerDefault}
          onChange={(e) => onChange({ ...provider, useServerDefault: e.target.checked })}
        />
        Използвай сървърния доставчик по подразбиране
      </label>
      {!provider.useServerDefault && (
        <div className="space-y-2">
          <select
            aria-label="Вид доставчик"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={provider.kind}
            onChange={(e) =>
              onChange({ ...provider, kind: e.target.value as ProviderConfig['kind'] })
            }
          >
            <option value="openai-compatible">OpenAI-съвместим</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <Input
            aria-label="Базов URL"
            placeholder="base URL (по избор)"
            value={provider.baseUrl ?? ''}
            onChange={(e) => onChange({ ...provider, baseUrl: e.target.value || null })}
          />
          <Input
            aria-label="Модел"
            placeholder="модел"
            value={provider.model}
            onChange={(e) => onChange({ ...provider, model: e.target.value })}
          />
          <Input
            aria-label="API ключ"
            type="password"
            placeholder="API ключ"
            value={provider.apiKey ?? ''}
            onChange={(e) => onChange({ ...provider, apiKey: e.target.value || null })}
          />
        </div>
      )}
    </div>
  );
}
