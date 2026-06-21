// In-memory registry of in-flight chat generations (mid-stream resume). A turn runs DETACHED from the
// request that started it, so a client disconnect/reload doesn't kill it — the generation keeps going,
// persists its result, and a reconnecting client re-attaches to the live token stream via `subscribe`
// (snapshot of what's produced so far + future events). Single-process/in-memory: a server restart
// loses in-flight generations (the question is already persisted; the user just re-asks).

import type { Citation, MapAnchor } from './grounding.ts';

/** Live token usage for a turn, surfaced to the client for an ↑input / ↓output readout. */
export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export type GenEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool'; name: string; status: 'start' | 'done' }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'anchors'; anchors: MapAnchor }
  | { type: 'grounding'; text: string }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface GenHandlers {
  onToken: (delta: string) => void;
  onTool: (name: string, status: 'start' | 'done') => void;
  onCitations: (citations: Citation[]) => void;
  onAnchors: (anchors: MapAnchor) => void;
  onGrounding: (text: string) => void;
  onUsage: (usage: UsageInfo) => void;
}

export type GenStatus = 'streaming' | 'done' | 'error';

export interface GenSnapshot {
  messageId: string;
  sessionId: string;
  userId: string;
  text: string;
  citations?: Citation[];
  anchors?: MapAnchor;
  usage?: UsageInfo;
  status: GenStatus;
  error?: string;
}

interface Generation extends GenSnapshot {
  listeners: Set<(e: GenEvent) => void>;
  abort: AbortController;
}

export interface StartOptions {
  messageId: string;
  sessionId: string;
  userId: string;
  /** Runs the turn; call the handlers as it streams. Reject to mark the generation errored. */
  run: (handlers: GenHandlers, signal: AbortSignal) => Promise<void>;
}

/** How long a finished generation stays subscribable (so a late reconnect still gets the result). */
const GRACE_MS = 60_000;

export class GenerationManager {
  private readonly gens = new Map<string, Generation>();

  constructor(private readonly graceMs = GRACE_MS) {}

  start(opts: StartOptions): void {
    const gen: Generation = {
      messageId: opts.messageId,
      sessionId: opts.sessionId,
      userId: opts.userId,
      text: '',
      status: 'streaming',
      listeners: new Set(),
      abort: new AbortController(),
    };
    this.gens.set(opts.messageId, gen);
    const emit = (e: GenEvent) => {
      for (const l of gen.listeners) l(e);
    };
    const handlers: GenHandlers = {
      onToken: (delta) => {
        gen.text += delta;
        emit({ type: 'token', delta });
      },
      onTool: (name, status) => emit({ type: 'tool', name, status }),
      onCitations: (citations) => {
        gen.citations = citations;
        emit({ type: 'citations', citations });
      },
      onAnchors: (anchors) => {
        gen.anchors = anchors;
        emit({ type: 'anchors', anchors });
      },
      onGrounding: (text) => emit({ type: 'grounding', text }),
      onUsage: (usage) => {
        gen.usage = usage;
        emit({ type: 'usage', usage });
      },
    };
    // Defer the run so the initiating request can subscribe before the first token.
    queueMicrotask(() => {
      opts
        .run(handlers, gen.abort.signal)
        .then(() => {
          gen.status = 'done';
          emit({ type: 'done' });
        })
        .catch((e) => {
          gen.status = 'error';
          gen.error = e instanceof Error ? e.message : 'generation failed';
          emit({ type: 'error', message: gen.error });
        })
        .finally(() => {
          const t = setTimeout(() => this.gens.delete(opts.messageId), this.graceMs);
          (t as { unref?: () => void }).unref?.();
        });
    });
  }

  /** Subscribe to a generation: returns its current snapshot + an unsubscribe, or null if unknown. */
  subscribe(
    messageId: string,
    listener: (e: GenEvent) => void,
  ): { snapshot: GenSnapshot; unsubscribe: () => void } | null {
    const gen = this.gens.get(messageId);
    if (!gen) return null;
    gen.listeners.add(listener);
    return { snapshot: snapshotOf(gen), unsubscribe: () => gen.listeners.delete(listener) };
  }

  snapshot(messageId: string): GenSnapshot | undefined {
    const gen = this.gens.get(messageId);
    return gen ? snapshotOf(gen) : undefined;
  }

  /** The in-flight generation id for a session, if any (used to offer a re-attach on resume). */
  activeForSession(sessionId: string): string | undefined {
    for (const gen of this.gens.values()) {
      if (gen.sessionId === sessionId && gen.status === 'streaming') return gen.messageId;
    }
    return undefined;
  }

  /** Request a server-side stop. Returns false if the generation is unknown. */
  stop(messageId: string): boolean {
    const gen = this.gens.get(messageId);
    if (!gen) return false;
    gen.abort.abort();
    return true;
  }
}

function snapshotOf(gen: Generation): GenSnapshot {
  return {
    messageId: gen.messageId,
    sessionId: gen.sessionId,
    userId: gen.userId,
    text: gen.text,
    ...(gen.citations ? { citations: gen.citations } : {}),
    ...(gen.anchors ? { anchors: gen.anchors } : {}),
    ...(gen.usage ? { usage: gen.usage } : {}),
    status: gen.status,
    ...(gen.error ? { error: gen.error } : {}),
  };
}
