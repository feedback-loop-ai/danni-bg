// Ory Kratos client (spec 019). Self-service flows run through the SPA's `/kratos` proxy (first-party
// cookies/CSRF). The pure helpers (message + value extraction) are unit-tested; the FrontendApi
// instance does the IO.

import { Configuration, FrontendApi, type UiContainer } from '@ory/client';

const basePath = (import.meta.env?.VITE_KRATOS_PUBLIC_URL as string | undefined) ?? '/kratos';

export const kratos = new FrontendApi(
  new Configuration({ basePath, baseOptions: { withCredentials: true } }),
);

export type FlowKind = 'login' | 'registration' | 'recovery' | 'verification';

/** Human-readable messages from a Kratos UI container (flow-level + per-node). Pure → tested. */
export function flowMessages(ui: UiContainer | undefined | null): string[] {
  if (!ui) return [];
  const out: string[] = [];
  for (const m of ui.messages ?? []) out.push(m.text);
  for (const n of ui.nodes) for (const m of n.messages ?? []) out.push(m.text);
  return out;
}

/** Default form values from a flow's input nodes (carries csrf_token + prefilled fields). Pure → tested. */
export function defaultValues(ui: UiContainer | undefined | null): Record<string, string> {
  const values: Record<string, string> = {};
  if (!ui) return values;
  for (const node of ui.nodes) {
    if (node.type !== 'input') continue;
    const attrs = node.attributes as { name?: string; value?: unknown; type?: string };
    if (!attrs.name || attrs.type === 'submit' || attrs.type === 'button') continue;
    if (attrs.value !== undefined && attrs.value !== null) values[attrs.name] = String(attrs.value);
  }
  return values;
}
