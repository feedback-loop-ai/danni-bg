// Chat streaming client (T050). The event→callback dispatch is a pure function (unit-tested); the
// sendChat IO wrapper reads the SSE body via the tested decoder and forwards decoded events to it.

import type { Citation, MapAnchor, ProviderConfig, ScopeDescriptor } from '../types.ts';
import { type SSEEvent, createSSEDecoder, parseEventData } from './sse.ts';

export interface ChatCallbacks {
  onSession?: (sessionId: string) => void;
  onToken?: (delta: string) => void;
  onTool?: (name: string, status: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onAnchors?: (anchor: MapAnchor) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export interface ChatRequestBody {
  sessionId: string | null;
  message: string;
  scope: ScopeDescriptor;
  provider: ProviderConfig;
}

/** Route one decoded SSE event to the matching callback. Pure + exhaustively unit-tested. */
export function dispatchSSEEvent(ev: SSEEvent, cb: ChatCallbacks): void {
  switch (ev.event) {
    case 'session':
      cb.onSession?.(parseEventData<{ sessionId: string }>(ev).sessionId);
      return;
    case 'token':
      cb.onToken?.(parseEventData<{ delta: string }>(ev).delta);
      return;
    case 'tool': {
      const t = parseEventData<{ name: string; status: string }>(ev);
      cb.onTool?.(t.name, t.status);
      return;
    }
    case 'citations':
      cb.onCitations?.(parseEventData<{ citations: Citation[] }>(ev).citations);
      return;
    case 'anchors':
      cb.onAnchors?.(parseEventData<MapAnchor>(ev));
      return;
    case 'error':
      cb.onError?.(parseEventData<{ message: string }>(ev).message);
      return;
    case 'done':
      cb.onDone?.();
      return;
  }
}

export async function sendChat(
  body: ChatRequestBody,
  cb: ChatCallbacks,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.body) {
    cb.onError?.('no response stream');
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const sse = createSSEDecoder();
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (chunk.value) {
      for (const ev of sse.push(decoder.decode(chunk.value, { stream: true }))) {
        dispatchSSEEvent(ev, cb);
      }
    }
  }
}
