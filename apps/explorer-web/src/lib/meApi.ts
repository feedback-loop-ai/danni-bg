// Per-user self API client (token metering): the caller's own token usage + quota.

export interface MyUsage {
  used: number;
  input: number;
  output: number;
  cached: number; // cache-hit input tokens (a subset of input)
  limit: number; // 0 = unlimited
  remaining: number | null; // null = unlimited
  exceeded: boolean;
  requests: number;
  lastUsedAt: string | null;
}

export async function getMyUsage(): Promise<MyUsage> {
  const res = await fetch('/api/me/usage', { credentials: 'include' });
  if (!res.ok) throw new Error(`usage request failed: ${res.status}`);
  return (await res.json()) as MyUsage;
}

export async function setMyAvatar(avatarUrl: string | null): Promise<void> {
  const res = await fetch('/api/me/avatar', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ avatarUrl }),
  });
  if (!res.ok) throw new Error(`avatar update failed: ${res.status}`);
}

// Resumable chat history (token persistence).
export interface SessionSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: import('../types.ts').Citation[];
}

export interface ResumedSession {
  sessionId: string;
  messages: SessionMessage[];
  contextDatasetIds: string[];
  /** Present when a generation is still running for this session (re-attach via resumeChat). */
  streaming?: { messageId: string };
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch('/api/me/sessions', { credentials: 'include' });
  if (!res.ok) throw new Error(`sessions request failed: ${res.status}`);
  return ((await res.json()) as { sessions: SessionSummary[] }).sessions;
}

export async function getSession(id: string): Promise<ResumedSession> {
  const res = await fetch(`/api/me/sessions/${id}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`session request failed: ${res.status}`);
  return (await res.json()) as ResumedSession;
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/me/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error(`session delete failed: ${res.status}`);
}

/** Ask the server to stop an in-flight generation (mid-stream resume). Best-effort. */
export async function stopGeneration(messageId: string): Promise<void> {
  await fetch(`/api/me/generations/${messageId}/stop`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
}
