// Per-user token-usage section for the settings page (token metering). Shows the caller's own usage
// against their effective quota with a small progress bar.

import { useEffect, useState } from 'react';
import { type MyUsage, getMyUsage } from '../lib/meApi.ts';

const nf = new Intl.NumberFormat('bg-BG');

export function SelfUsage() {
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    getMyUsage()
      .then((u) => active && setUsage(u))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);

  const unlimited = usage != null && usage.limit <= 0;
  const pct =
    usage && usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;

  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h2 className="text-sm font-semibold">Употреба на токени</h2>
        <p className="text-xs text-muted-foreground">Изразходвани токени за чата</p>
      </div>
      {error ? (
        <p className="text-sm text-destructive">Неуспешно зареждане.</p>
      ) : usage == null ? (
        <p className="text-sm text-muted-foreground">Зареждане…</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span>{nf.format(usage.used)} токена</span>
            <span className="text-muted-foreground">
              {unlimited ? 'без лимит' : `от ${nf.format(usage.limit)}`}
            </span>
          </div>
          {unlimited ? null : (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={usage.exceeded ? 'h-full bg-destructive' : 'h-full bg-primary'}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Вход</dt>
              <dd>{nf.format(usage.input)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Изход</dt>
              <dd>{nf.format(usage.output)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Кеш</dt>
              <dd>{nf.format(usage.cached)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {usage.requests} заявки
            {usage.exceeded ? ' · лимитът е достигнат' : ''}
          </p>
        </div>
      )}
    </section>
  );
}
