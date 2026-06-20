import { ArrowUp, Plus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { useAuth } from '../auth/AuthContext.tsx';
import { completePartialMarkdown } from '../lib/markdown.ts';
import { filterStateToScope } from '../lib/scope.ts';
import { useExplorer } from '../store/explorerStore.ts';
import type { Citation, ProviderConfig } from '../types.ts';
import { sendChat } from './sendChat.ts';

// The chat always uses the admin-configured server default — there's no per-user provider override
// (it would bypass the platform LLM config + token metering). A non-empty model satisfies the
// request schema; the server ignores it when useServerDefault is set.
const SERVER_DEFAULT_PROVIDER: ProviderConfig = {
  kind: 'openai-compatible',
  baseUrl: null,
  model: 'server-default',
  apiKey: null,
  useServerDefault: true,
};

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

interface ChatPanelProps {
  onSelectDataset: (datasetId: string) => void;
}

const SUGGESTIONS = [
  'Какви данни има за качеството на въздуха?',
  'Сравни ПТП с фатален край по години',
  'Кои набори са за бюджета на общините?',
];

export function ChatPanel({ onSelectDataset }: ChatPanelProps) {
  const filters = useExplorer((s) => s.filters);
  const setHighlight = useExplorer((s) => s.setHighlight);
  const chatFocus = useExplorer((s) => s.chatFocus);
  const setChatFocus = useExplorer((s) => s.setChatFocus);
  const reader = useExplorer((s) => s.reader);
  const { user } = useAuth();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // When a dataset focus is set ("ask about this dataset"), prefill a question about it.
  useEffect(() => {
    if (chatFocus) setInput(`Какво съдържа наборът „${chatFocus.titleBg}"?`);
  }, [chatFocus]);

  // Keep the latest message in view as the answer streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function patchAssistant(content: string, citations?: Citation[]) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') {
        copy[copy.length - 1] = { ...last, content, ...(citations ? { citations } : {}) };
      }
      return copy;
    });
  }

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || streaming) return;
    setInput('');
    setError(null);
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { id: ++idRef.current, role: 'user', content: question },
      { id: ++idRef.current, role: 'assistant', content: '' },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistant = '';
    let cites: Citation[] = [];
    try {
      const scope = {
        ...filterStateToScope(filters),
        ...(chatFocus ? { datasetIds: [chatFocus.datasetId] } : {}),
      };
      // Auto-focus the dataset open in the reader: ground the answer in its rows without narrowing
      // scope. A deliberate chatFocus (scope.datasetIds) takes precedence on the backend.
      await sendChat(
        {
          sessionId,
          message: question,
          scope,
          ...(reader ? { groundingDatasetIds: [reader.datasetId] } : {}),
          provider: SERVER_DEFAULT_PROVIDER,
        },
        {
          onSession: setSessionId,
          onToken: (delta) => {
            assistant += delta;
            patchAssistant(assistant, cites.length > 0 ? cites : undefined);
          },
          onCitations: (citations) => {
            cites = citations;
            patchAssistant(assistant, cites);
          },
          onAnchors: (anchor) => setHighlight(anchor),
          onError: (message) => setError(message),
          onDone: () => setStreaming(false),
        },
        undefined,
        controller.signal,
      );
    } catch {
      // A user-initiated stop aborts the fetch; that's not an error.
      if (!controller.signal.aborted) setError('мрежова грешка');
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  /** Start a fresh conversation: drop the server session + transcript and clear chat-driven state. */
  function newChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages([]);
    setSessionId(null);
    setError(null);
    setInput('');
    setChatFocus(null);
    setHighlight({ geoEntityIds: [], datasetIds: [] });
  }

  const empty = messages.length === 0;

  return (
    <section className="relative flex h-full flex-col gap-3">
      {/* When signed out, the whole chat is blurred + non-interactive behind a centered prompt. */}
      <div
        className={
          user
            ? 'flex h-full min-h-0 flex-col gap-3'
            : 'pointer-events-none flex h-full min-h-0 select-none flex-col gap-3 blur-sm'
        }
      >
        <div ref={scrollRef} aria-label="Разговор" className="flex-1 space-y-4 overflow-y-auto">
          {empty && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-2 text-center">
              <p className="text-sm text-muted-foreground">
                Задайте въпрос за публичните данни — отговорите се базират на наличните набори и
                посочват източници.
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-lg border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div
                key={m.id}
                className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
              >
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="space-y-2">
                <div className="prose prose-sm prose-slate max-w-none dark:prose-invert prose-headings:mt-2 prose-p:my-1.5 prose-ol:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
                  {m.content ? (
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {completePartialMarkdown(m.content)}
                    </Markdown>
                  ) : (
                    streaming && <span className="text-muted-foreground">…</span>
                  )}
                </div>
                {m.citations && m.citations.length > 0 && (
                  <div className="citation space-y-1 border-l-2 border-primary/30 pl-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Източници
                    </p>
                    {m.citations.map((c) => (
                      <div key={c.datasetId} className="flex items-start gap-1 text-xs">
                        <button
                          type="button"
                          className="text-left text-primary underline-offset-2 hover:underline"
                          onClick={() => onSelectDataset(c.datasetId)}
                        >
                          {c.titleBg}
                        </button>
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-primary"
                        >
                          ↗
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {chatFocus && (
          <div className="flex items-center gap-1 text-xs">
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-accent-foreground">
              <span className="truncate">Контекст: {chatFocus.titleBg}</span>
              <button
                type="button"
                aria-label="Премахни контекста"
                onClick={() => setChatFocus(null)}
                className="flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-primary/20"
              >
                <X className="size-3" />
              </button>
            </span>
          </div>
        )}
        <div className="relative rounded-3xl border border-input bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <textarea
            aria-label="Въпрос"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Попитайте за публичните данни…"
            className="max-h-40 w-full resize-none bg-transparent py-3 pr-12 pl-12 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <button
            type="button"
            aria-label="Нов разговор"
            title="Нов разговор"
            disabled={empty && !streaming && !chatFocus && !error}
            onClick={newChat}
            className="absolute bottom-2 left-2 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-all hover:scale-110 hover:bg-accent hover:text-accent-foreground active:scale-95 disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-transparent"
          >
            <Plus className="size-4" />
          </button>
          {streaming ? (
            <button
              type="button"
              aria-label="Спри генерирането"
              onClick={stop}
              className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:scale-110 hover:bg-primary/90 active:scale-95"
            >
              <Square className="size-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Изпрати"
              disabled={input.trim() === ''}
              onClick={() => void send()}
              className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:scale-110 hover:bg-primary/90 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>

      {!user ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
          <p className="max-w-[16rem] text-sm text-muted-foreground">
            <Link to="/auth/login" className="font-medium text-primary hover:underline">
              Влезте
            </Link>{' '}
            в профила си, за да използвате чата.
          </p>
        </div>
      ) : null}
    </section>
  );
}
