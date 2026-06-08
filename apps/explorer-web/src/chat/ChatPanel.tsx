import { ArrowUp, Cog, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { completePartialMarkdown } from '../lib/markdown.ts';
import { filterStateToScope } from '../lib/scope.ts';
import { useExplorer } from '../store/explorerStore.ts';
import type { Citation, ProviderConfig } from '../types.ts';
import { ProviderSettings } from './ProviderSettings.tsx';
import { loadProvider, saveProvider } from './providerStorage.ts';
import { sendChat } from './sendChat.ts';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

interface ChatPanelProps {
  onSelectDataset: (datasetId: string) => void;
}

export function ChatPanel({ onSelectDataset }: ChatPanelProps) {
  const filters = useExplorer((s) => s.filters);
  const setHighlight = useExplorer((s) => s.setHighlight);
  const chatFocus = useExplorer((s) => s.chatFocus);
  const setChatFocus = useExplorer((s) => s.setChatFocus);

  const [provider, setProvider] = useState<ProviderConfig>(() => loadProvider(localStorage));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
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

  function updateProvider(next: ProviderConfig) {
    setProvider(next);
    saveProvider(localStorage, next);
  }

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

  async function send() {
    const question = input.trim();
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
      await sendChat(
        { sessionId, message: question, scope, provider },
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

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Чат</h2>
        <button
          type="button"
          aria-label="Настройки на доставчика"
          aria-pressed={showSettings}
          onClick={() => setShowSettings((v) => !v)}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Cog className="size-4" />
        </button>
      </div>
      {showSettings && <ProviderSettings provider={provider} onChange={updateProvider} />}
      <div ref={scrollRef} aria-label="Разговор" className="flex-1 space-y-4 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Задайте въпрос за публичните данни — отговорите се базират на наличните набори.
          </p>
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
          className="max-h-40 w-full resize-none bg-transparent py-3 pr-12 pl-4 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
        />
        {streaming ? (
          <button
            type="button"
            aria-label="Спри генерирането"
            onClick={stop}
            className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Square className="size-3.5" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Изпрати"
            disabled={input.trim() === ''}
            onClick={() => void send()}
            className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:bg-primary/90 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </section>
  );
}
