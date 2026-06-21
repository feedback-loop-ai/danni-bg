// Persistent, per-user chat session store (resumable history).

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../../src/store/migrate.ts';
import type { ChatMessage } from '../src/chat/session.ts';
import { PersistentSessionStore } from '../src/chat/sessions-repo.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const assistantWithCite = (content: string): ChatMessage =>
  ({
    role: 'assistant',
    content,
    citations: [{ datasetId: 'd1', titleBg: 'Въздух', sourceUrl: 'http://x', freshness: {} }],
  }) as unknown as ChatMessage;

describe('PersistentSessionStore', () => {
  let db: Database;
  let store: PersistentSessionStore;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, join(ROOT, 'migrations'));
    store = new PersistentSessionStore(db);
  });
  afterEach(() => db.close());

  it('persists messages + a title from the first question, and resumes the conversation', () => {
    const conv = store.getOrCreate(null, 'u1');
    store.append(conv.sessionId, { role: 'user', content: 'Какво има за въздуха?' });
    store.append(conv.sessionId, assistantWithCite('Ето данните…'));

    const resumed = store.getOrCreate(conv.sessionId, 'u1');
    expect(resumed.sessionId).toBe(conv.sessionId);
    expect(resumed.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(resumed.messages[1]?.citations?.[0]?.datasetId).toBe('d1');
    expect(store.listForUser('u1')[0]?.title).toBe('Какво има за въздуха?');
  });

  it('never resumes or exposes another user’s session', () => {
    const conv = store.getOrCreate(null, 'u1');
    store.append(conv.sessionId, { role: 'user', content: 'x' });
    const other = store.getOrCreate(conv.sessionId, 'u2'); // u2 asks for u1's id
    expect(other.sessionId).not.toBe(conv.sessionId); // gets a fresh, empty session instead
    expect(other.messages).toHaveLength(0);
    expect(store.getForUser(conv.sessionId, 'u2')).toBeNull();
    expect(store.listForUser('u2')).toHaveLength(1); // only its own fresh one
  });

  it('persists per-message token usage + reply duration (kept across resume)', () => {
    const conv = store.getOrCreate(null, 'u1');
    store.append(conv.sessionId, { role: 'user', content: 'въздух?' });
    store.append(conv.sessionId, {
      role: 'assistant',
      content: 'Ето…',
      usage: { inputTokens: 1293, outputTokens: 55, cachedInputTokens: 1280 },
      durationMs: 1638,
    });
    const a = store.getForUser(conv.sessionId, 'u1')?.messages[1];
    expect(a?.usage).toEqual({ inputTokens: 1293, outputTokens: 55, cachedInputTokens: 1280 });
    expect(a?.durationMs).toBe(1638);
  });

  it('persists the sticky grounding context', () => {
    const conv = store.getOrCreate(null, 'u1');
    store.setContext(conv.sessionId, ['d1', 'd2']);
    expect(store.getForUser(conv.sessionId, 'u1')?.contextDatasetIds).toEqual(['d1', 'd2']);
  });

  it('deletes a conversation + its messages, owner only', () => {
    const conv = store.getOrCreate(null, 'u1');
    store.append(conv.sessionId, { role: 'user', content: 'x' });
    expect(store.deleteForUser(conv.sessionId, 'u2')).toBe(false);
    expect(store.deleteForUser(conv.sessionId, 'u1')).toBe(true);
    expect(store.getForUser(conv.sessionId, 'u1')).toBeNull();
    expect(db.query('SELECT COUNT(*) AS n FROM chat_messages').get()).toEqual({ n: 0 });
  });
});
