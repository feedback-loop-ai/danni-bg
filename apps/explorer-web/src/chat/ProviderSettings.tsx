import type { ProviderConfig } from '../types.ts';

interface ProviderSettingsProps {
  provider: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
}

export function ProviderSettings({ provider, onChange }: ProviderSettingsProps) {
  return (
    <details>
      <summary>Настройки на доставчика</summary>
      <label>
        <input
          type="checkbox"
          checked={provider.useServerDefault}
          onChange={(e) => onChange({ ...provider, useServerDefault: e.target.checked })}
        />
        Използвай сървърния доставчик по подразбиране
      </label>
      {!provider.useServerDefault && (
        <div>
          <select
            aria-label="Вид доставчик"
            value={provider.kind}
            onChange={(e) =>
              onChange({ ...provider, kind: e.target.value as ProviderConfig['kind'] })
            }
          >
            <option value="openai-compatible">OpenAI-съвместим</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input
            aria-label="Базов URL"
            placeholder="base URL (по избор)"
            value={provider.baseUrl ?? ''}
            onChange={(e) => onChange({ ...provider, baseUrl: e.target.value || null })}
          />
          <input
            aria-label="Модел"
            placeholder="модел"
            value={provider.model}
            onChange={(e) => onChange({ ...provider, model: e.target.value })}
          />
          <input
            aria-label="API ключ"
            type="password"
            placeholder="API ключ"
            value={provider.apiKey ?? ''}
            onChange={(e) => onChange({ ...provider, apiKey: e.target.value || null })}
          />
        </div>
      )}
    </details>
  );
}
