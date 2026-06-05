import { useState } from 'react';
import { filterStateToScope } from '../lib/scope.ts';
import { useExplorer } from '../store/explorerStore.ts';
import type { Citation, ProviderConfig } from '../types.ts';
import { ProviderSettings } from './ProviderSettings.tsx';
import { loadProvider, saveProvider } from './providerStorage.ts';
import { sendChat } from './sendChat.ts';

interface ChatMessage {
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

  function updateProvider(next: ProviderConfig) {
    setProvider(next);
    saveProvider(localStorage, next);
  }

  function patchAssistant(content: string, citations?: Citation[]) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') {
        copy[copy.length - 1] = { role: 'assistant', content, ...(citations ? { citations } : {}) };
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
      { role: 'user', content: question },
      { role: 'assistant', content: '' },
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
    <section>
      <h2>Чат</h2>
      <ProviderSettings provider={provider} onChange={updateProvider} />
      <div aria-label="Разговор">
        {messages.map((m, i) => (
          <div key={`${i}:${m.role}`} className={m.role === 'user' ? 'msg-user' : undefined}>
            <p>{m.content || (m.role === 'assistant' && streaming ? '…' : '')}</p>
            {m.citations && m.citations.length > 0 && (
              <ul className="citation">
                {m.citations.map((c) => (
                  <li key={c.datasetId}>
                    <button type="button" onClick={() => onSelectDataset(c.datasetId)}>
                      {c.titleBg}
                    </button>{' '}
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <textarea
        aria-label="Въпрос"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Попитайте за публичните данни…"
      />
      <button type="button" disabled={streaming} onClick={() => void send()}>
        Изпрати
      </button>
    </section>
  );
}
