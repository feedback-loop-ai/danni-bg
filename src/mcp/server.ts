import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import type { Embedder } from '../index/embedder.ts';
import { search, searchByEntity } from '../index/query.ts';
import { datasetView } from '../read/dataset-view.ts';
import { readResourceRows } from '../read/resource-rows.ts';

/**
 * A dependency-free Model Context Protocol server over the read API — read-only, so an LLM agent
 * can search, inspect and pull curated data.egov.bg datasets without touching the live portal or
 * the write pipeline. The stdio transport is newline-delimited JSON-RPC 2.0; this module is the
 * pure request handler (no I/O) so it can be exercised directly in tests. Only the small core the
 * spec requires is implemented (initialize / tools/list / tools/call / ping); swapping in the
 * official @modelcontextprotocol/sdk later is a transport-only change.
 */
export interface McpContext {
  db: Database;
  storeRoot: string;
  embedder: Embedder;
  freshnessSloSeconds: number;
}

export const SERVER_INFO = { name: 'danni-bg', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: unknown, ctx: McpContext) => Promise<unknown>;
}

const limitField = { type: 'integer', minimum: 1, maximum: 50 } as const;

export const TOOLS: ToolDef[] = [
  {
    name: 'mirror_search',
    description:
      'Hybrid keyword + semantic search over the curated data.egov.bg mirror. Returns ranked dataset pointers, each with title (bg/en), publisher, sourceUrl and curatedDatasetPath for one-hop traceability.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search text, Bulgarian or English.' },
        lang: {
          type: 'string',
          enum: ['bg', 'en', 'auto'],
          description: 'Optional language hint.',
        },
        limit: { ...limitField, description: 'Max results (default 5).' },
      },
    },
    run: async (raw, ctx) => {
      const a = z
        .object({
          query: z.string().min(1),
          lang: z.enum(['bg', 'en', 'auto']).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .parse(raw);
      return search({
        db: ctx.db,
        embedder: ctx.embedder,
        query: a.query,
        freshnessSloSeconds: ctx.freshnessSloSeconds,
        ...(a.lang !== undefined ? { lang: a.lang } : {}),
        ...(a.limit !== undefined ? { limit: a.limit } : {}),
      });
    },
  },
  {
    name: 'mirror_entity_search',
    description:
      'Find every curated dataset linked to a given entity (organization, geographic unit, time period, tag, …) by its entityId. Returns dataset pointers with the matched entity label.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['entityId'],
      properties: {
        entityId: {
          type: 'string',
          description: 'Entity id (from mirror_info entities[].entityId).',
        },
        limit: { ...limitField, description: 'Max results (default 50, capped at 50 here).' },
      },
    },
    run: async (raw, ctx) => {
      const a = z
        .object({ entityId: z.string().min(1), limit: z.number().int().min(1).max(50).optional() })
        .parse(raw);
      return searchByEntity(
        {
          db: ctx.db,
          embedder: ctx.embedder,
          query: '',
          freshnessSloSeconds: ctx.freshnessSloSeconds,
          ...(a.limit !== undefined ? { limit: a.limit } : {}),
        },
        a.entityId,
      );
    },
  },
  {
    name: 'mirror_info',
    description:
      'The full curated-dataset record for one datasetId: title/description (bg + en), publisher, resources (with curated paths + schema), extracted entities, cross-dataset links, and freshness.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['datasetId'],
      properties: { datasetId: { type: 'string' } },
    },
    run: async (raw, ctx) => {
      const a = z.object({ datasetId: z.string().min(1) }).parse(raw);
      return datasetView(ctx.db, a.datasetId, ctx.freshnessSloSeconds);
    },
  },
  {
    name: 'read_resource',
    description:
      "Read a resource's curated content off disk. Tabular/NDJSON and JSON-array artifacts return paginated `rows`; a single JSON/GeoJSON document returns `document`; XML/text returns `text`.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['datasetId', 'resourceId'],
      properties: {
        datasetId: { type: 'string' },
        resourceId: { type: 'string' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          description: 'Rows per page (default 100).',
        },
        offset: { type: 'integer', minimum: 0, description: 'Row offset (default 0).' },
      },
    },
    run: async (raw, ctx) => {
      const a = z
        .object({
          datasetId: z.string().min(1),
          resourceId: z.string().min(1),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .parse(raw);
      return readResourceRows(ctx.db, ctx.storeRoot, a.datasetId, a.resourceId, {
        ...(a.limit !== undefined ? { limit: a.limit } : {}),
        ...(a.offset !== undefined ? { offset: a.offset } : {}),
      });
    },
  },
];

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}
function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Handle one JSON-RPC message. Returns the response, or `null` for a notification (no `id`) — the
 * caller must not write anything for a null return. Tool failures are returned as a successful
 * envelope with `isError: true` (MCP convention); only protocol-level problems use JSON-RPC errors.
 */
export async function handleRpc(
  msg: JsonRpcRequest,
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  // A notification has no `id` member; per JSON-RPC 2.0 it MUST NOT receive a response. This
  // read server has no side effects to run on a notification (e.g. notifications/initialized),
  // so any notification is simply accepted with no output.
  if (msg.id === undefined) return null;
  const id = msg.id;

  if (typeof msg.method !== 'string') {
    return fail(id, -32600, 'invalid request: missing method');
  }

  switch (msg.method) {
    case 'initialize':
      // We support exactly one protocol version; advertise it (do not echo an arbitrary client value).
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case 'tools/call': {
      const params = msg.params as { name?: string; arguments?: unknown } | undefined;
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) {
        return ok(id, {
          content: [{ type: 'text', text: `unknown tool: ${params?.name}` }],
          isError: true,
        });
      }
      try {
        const result = await tool.run(params?.arguments ?? {}, ctx);
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (err) {
        return ok(id, {
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
    }
    default:
      return fail(id, -32601, `method not found: ${msg.method}`);
  }
}
