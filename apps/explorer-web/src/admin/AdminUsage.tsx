// Admin per-user token usage + quota table (token metering). Shows everyone's usage against their
// effective limit; an admin can set/clear each user's per-user limit and reset their counter.

import { useEffect, useState } from 'react';
import { type AdminUsageRow, getUsage, resetUserUsage, setUserLimit } from '../lib/adminApi.ts';

const nf = new Intl.NumberFormat('bg-BG');
const fmtLimit = (limit: number) => (limit <= 0 ? '∞' : nf.format(limit));

export function AdminUsage() {
  const [rows, setRows] = useState<AdminUsageRow[] | null>(null);
  const [defaultLimit, setDefaultLimit] = useState(0);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  async function load() {
    try {
      const u = await getUsage();
      setRows(u.users);
      setDefaultLimit(u.defaultLimit);
      setEdits({});
    } catch {
      setError(true);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function saveLimit(row: AdminUsageRow) {
    const raw = (edits[row.userId] ?? '').trim();
    const limit = raw === '' ? null : Number.parseInt(raw, 10);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return;
    await setUserLimit(row.userId, limit);
    await load();
  }
  async function reset(row: AdminUsageRow) {
    await resetUserUsage(row.userId);
    await load();
  }

  if (error) return <p className="text-sm text-destructive">Неуспешно зареждане на употребата.</p>;
  if (rows == null) return <p className="text-sm text-muted-foreground">Зареждане…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Употреба на токени по потребител</h2>
        <span className="text-xs text-muted-foreground">
          По подразбиране: {fmtLimit(defaultLimit)}
        </span>
      </div>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-border border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Потребител</th>
              <th className="px-3 py-2 text-right font-medium">Употреба</th>
              <th className="px-3 py-2 text-right font-medium">Заявки</th>
              <th className="px-3 py-2 font-medium">Личен лимит</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-border border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.displayName?.trim() || r.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.email}
                    {r.role === 'admin' ? ' · админ' : ''}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={r.exceeded ? 'font-medium text-destructive' : ''}>
                    {nf.format(r.used)}
                  </span>
                  <span className="text-muted-foreground"> / {fmtLimit(r.limit)}</span>
                </td>
                <td className="px-3 py-2 text-right">{nf.format(r.requests)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <input
                      aria-label={`Лимит за ${r.email}`}
                      className="w-24 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                      placeholder="по подразб."
                      value={edits[r.userId] ?? r.tokenLimit?.toString() ?? ''}
                      onChange={(e) => setEdits((m) => ({ ...m, [r.userId]: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => void saveLimit(r)}
                      className="rounded border border-border px-2 py-1 text-xs transition hover:bg-accent"
                    >
                      Запази
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void reset(r)}
                    className="rounded border border-border px-2 py-1 text-xs text-destructive transition hover:bg-destructive/10"
                  >
                    Нулирай
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Празно поле = лимит по подразбиране; 0 = без лимит. „Нулирай" започва нов период на
        отчитане.
      </p>
    </div>
  );
}
