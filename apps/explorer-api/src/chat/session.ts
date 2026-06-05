// In-memory, session-scoped conversation store (T048). Conversations are held only for the active
// session and are NEVER persisted server-side (FR-019). Discarded when the process restarts.

import type { Citation, MapAnchor } from './grounding.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  anchors?: MapAnchor;
}

export interface Conversation {
  sessionId: string;
  messages: ChatMessage[];
}

export class SessionStore {
  private readonly sessions = new Map<string, Conversation>();

  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  /** Return the existing conversation for `sessionId`, or create a fresh one (new id when null). */
  getOrCreate(sessionId: string | null): Conversation {
    if (sessionId !== null) {
      const existing = this.sessions.get(sessionId);
      if (existing) return existing;
    }
    const conv: Conversation = { sessionId: sessionId ?? this.newId(), messages: [] };
    this.sessions.set(conv.sessionId, conv);
    return conv;
  }

  append(sessionId: string, message: ChatMessage): void {
    const conv = this.sessions.get(sessionId);
    if (conv) conv.messages.push(message);
  }

  get(sessionId: string): Conversation | undefined {
    return this.sessions.get(sessionId);
  }
}
