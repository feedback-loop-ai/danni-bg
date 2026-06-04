import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { dispatchLine, runStdio } from '../../../src/cli/mcp.ts';
import { LocalOnnxEmbedder } from '../../../src/index/embedders/local-onnx.ts';
import type { McpContext } from '../../../src/mcp/server.ts';
import { runMigrations } from '../../../src/store/migrate.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../migrations', import.meta.url));

function makeCtx(): McpContext {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db, MIGRATIONS);
  return {
    db,
    storeRoot: globalThis.__TEST_TMP_DIR__,
    embedder: new LocalOnnxEmbedder({ dimension: 8 }),
    freshnessSloSeconds: 86400,
  };
}

async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  for (const p of parts) yield enc.encode(p);
}

describe('cli.mcp dispatchLine', () => {
  let ctx: McpContext;
  beforeEach(() => {
    ctx = makeCtx();
  });
  afterEach(() => ctx.db.close());

  it('dispatches a valid JSON-RPC line', async () => {
    const r = await dispatchLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), ctx);
    expect(r?.result).toEqual({});
  });

  it('returns a -32700 parse error (id null) on malformed JSON', async () => {
    const r = await dispatchLine('{not json', ctx);
    expect(r?.error?.code).toBe(-32700);
    expect(r?.id).toBeNull();
  });
});

describe('cli.mcp runStdio', () => {
  let ctx: McpContext;
  beforeEach(() => {
    ctx = makeCtx();
  });
  afterEach(() => ctx.db.close());

  it('frames newline-delimited messages across chunk boundaries and emits nothing for notifications', async () => {
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    const notif = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const out: string[] = [];
    // First message is split across two chunks to exercise the buffer.
    await runStdio(ctx, chunks(init.slice(0, 12), `${init.slice(12)}\n${notif}\n${list}\n`), (s) =>
      out.push(s),
    );
    expect(out.length).toBe(2); // init + list responses; the notification produces no output
    expect(JSON.parse(out[0] ?? '{}').id).toBe(1);
    expect(JSON.parse(out[1] ?? '{}').id).toBe(2);
  });

  it('processes a final message that has no trailing newline', async () => {
    const out: string[] = [];
    await runStdio(ctx, chunks(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })), (s) =>
      out.push(s),
    );
    expect(out.length).toBe(1);
    expect(JSON.parse(out[0] ?? '{}').id).toBe(7);
  });
});
