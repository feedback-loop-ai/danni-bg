import { ArrowUp, Cog } from 'lucide-react';
import { useRef, useState } from 'react';
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

  const [provider, setProvider] = useState<ProviderConfig>(() => loadProvider(localStorage));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const idRef = useRef(0);

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

    let assistant = '';
    let cites: Citation[] = [];
    try {
      await sendChat(
        { sessionId, message: question, scope: filterStateToScope(filters), provider },
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
      );
    } catch {
      setError('мрежова грешка');
    } finally {
      setStreaming(false);
    }
  }

  return (
    <section className="space-y-3">
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
      <div aria-label="Разговор" className="space-y-4">
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
        <button
          type="button"
          aria-label="Изпрати"
          disabled={streaming || input.trim() === ''}
          onClick={() => void send()}
          className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:bg-primary/90 disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </section>
  );
}
