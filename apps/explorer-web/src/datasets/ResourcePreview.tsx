import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchResourceRows } from '../lib/api.ts';
import { cellText, tableColumns, toCsv } from '../lib/table.ts';
import type { ResourceContent } from '../types.ts';

const PAGE = 50;

interface ResourcePreviewProps {
  datasetId: string;
  resourceId: string;
  name: string;
  onClose: () => void;
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ResourcePreview({ datasetId, resourceId, name, onClose }: ResourcePreviewProps) {
  const [content, setContent] = useState<ResourceContent | null>(null);
  const [rows, setRows] = useState<unknown[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState(false);

  // Reset when the selected resource changes.
  useEffect(() => {
    setRows([]);
    setOffset(0);
    setContent(null);
    setError(false);
  }, [datasetId, resourceId]);

  useEffect(() => {
    let cancelled = false;
    fetchResourceRows(datasetId, resourceId, PAGE, offset)
      .then((c) => {
        if (cancelled) return;
        setContent(c);
        setRows((prev) => (offset === 0 ? c.rows : [...prev, ...c.rows]));
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [datasetId, resourceId, offset]);

  const columns = tableColumns(rows);
  const hasTable = rows.length > 0 && columns.length > 0;

  function onDownload() {
    if (!content) return;
    if (hasTable) download(`${resourceId}.csv`, toCsv(rows, tableColumns(rows, 100)), 'text/csv');
    else if (content.text !== undefined) download(`${resourceId}.txt`, content.text, 'text/plain');
    else
      download(
        `${resourceId}.json`,
        JSON.stringify(content.document ?? rows, null, 2),
        'application/json',
      );
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium" title={name}>
          {name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {content && (
            <button
              type="button"
              aria-label="Изтегли данните"
              onClick={onDownload}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Download className="size-4" />
            </button>
          )}
          <button
            type="button"
            aria-label="Затвори визуализацията"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">Грешка при зареждане на данните.</p>}
      {!content && !error && <p className="text-sm text-muted-foreground">Зареждане…</p>}

      {content && hasTable && (
        <>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="whitespace-nowrap border-b px-2 py-1 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are an ordered, append-only page
                  <tr key={i} className="even:bg-muted/40">
                    {columns.map((c) => {
                      const rec = row as Record<string, unknown>;
                      return (
                        <td
                          key={c}
                          className="max-w-[220px] truncate border-b px-2 py-1"
                          title={cellText(rec?.[c])}
                        >
                          {cellText(rec?.[c])}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {rows.length} от {content.total} реда
            </span>
            {rows.length < content.total && (
              <button
                type="button"
                onClick={() => setOffset(rows.length)}
                className="rounded-md border px-2 py-1 hover:bg-accent hover:text-accent-foreground"
              >
                Зареди още
              </button>
            )}
          </div>
        </>
      )}

      {content && !hasTable && content.text !== undefined && (
        <pre className="max-h-80 overflow-auto rounded border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
          {content.text}
        </pre>
      )}
      {content && !hasTable && content.text === undefined && (
        <pre className="max-h-80 overflow-auto rounded border bg-muted/30 p-2 text-xs">
          {JSON.stringify(content.document ?? rows, null, 2)}
        </pre>
      )}
    </div>
  );
}
