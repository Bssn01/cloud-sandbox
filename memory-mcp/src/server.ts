// ─────────────────────────────────────────────────────────────────────────────
// Memory MCP gateway.
//
// Exposes Hermes memory to both harnesses (Claude Code, Codex) as tools:
//   recall(query)   — search shared org memory
//   prefetch(query) — pull relevant context before a turn
//   write(content)  — persist a fact/turn
//
// Two tiers (matches Hermes: built-in always-on + one external provider):
//   - hot/local  : Hermes built-in SQLite/FTS (LocalHotTier — stubbed here)
//   - shared/VPS : external provider over HTTP (HermesRemoteTier)
//
// This skeleton serves a plain HTTP/JSON API (incl. /healthz used by the
// compose healthcheck). TODO (user's machine): wrap these tools with
// @modelcontextprotocol/sdk so harnesses consume them over the MCP protocol,
// and confirm the remote provider's request/response shape (hindsight|retaindb).
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MemoryRecord {
  content: string;
  namespace: string;
}

export interface MemoryTier {
  recall(query: string, namespace: string): Promise<string[]>;
  write(record: MemoryRecord): Promise<void>;
}

/** Built-in local hot tier (Hermes SQLite/FTS). Stub: real impl shells to Hermes. */
class LocalHotTier implements MemoryTier {
  private store: MemoryRecord[] = [];
  async recall(query: string, namespace: string): Promise<string[]> {
    return this.store
      .filter((r) => r.namespace === namespace && r.content.includes(query))
      .map((r) => r.content);
  }
  async write(record: MemoryRecord): Promise<void> {
    this.store.push(record);
  }
}

/** Shared cloud tier: external Hermes provider self-hosted on the VPS. */
class HermesRemoteTier implements MemoryTier {
  constructor(
    private endpoint: string,
    private apiKey: string,
  ) {}

  private async call(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`remote memory ${path} failed: ${res.status}`);
    return res.json();
  }

  async recall(query: string, namespace: string): Promise<string[]> {
    const out = (await this.call("/recall", { query, namespace })) as { results?: string[] };
    return out.results ?? [];
  }
  async write(record: MemoryRecord): Promise<void> {
    await this.call("/write", record);
  }
}

export class MemoryClient {
  constructor(
    private hot: MemoryTier,
    private shared: MemoryTier,
    private namespace: string,
  ) {}

  /** Recall merges shared (cross-agent) + hot (local) results, shared first. */
  async recall(query: string): Promise<string[]> {
    const [shared, hot] = await Promise.all([
      // A shared-tier outage degrades to local-only, but must be visible to operators.
      this.shared.recall(query, this.namespace).catch((err): string[] => {
        console.warn(`[memory] shared recall failed, using local only: ${String(err)}`);
        return [];
      }),
      this.hot.recall(query, this.namespace),
    ]);
    return [...shared, ...hot];
  }

  /** prefetch == recall, surfaced as a distinct tool for pre-turn context pull. */
  prefetch(query: string): Promise<string[]> {
    return this.recall(query);
  }

  /** Write mirrors to both tiers so every sub-agent sees it (shared) + fast local recall. */
  async write(content: string): Promise<void> {
    const record: MemoryRecord = { content, namespace: this.namespace };
    await Promise.all([
      this.hot.write(record),
      this.shared.write(record).catch((err) => {
        console.warn(`[memory] shared write failed, kept local only: ${String(err)}`);
      }),
    ]);
  }
}

// MCP tool schemas (mirrors Hermes MemoryProvider.get_tool_schemas()).
export const TOOL_SCHEMAS = [
  { name: "recall", description: "Search shared org memory", input: { query: "string" } },
  { name: "prefetch", description: "Pull relevant context before a turn", input: { query: "string" } },
  { name: "write", description: "Persist a fact to shared + local memory", input: { content: "string" } },
] as const;

function buildClient(): MemoryClient {
  const namespace = process.env.HERMES_SHARED_NAMESPACE || "org-default";
  const endpoint = process.env.HERMES_REMOTE_ENDPOINT || "";
  const apiKey = process.env.HERMES_REMOTE_API_KEY || "";
  return new MemoryClient(new LocalHotTier(), new HermesRemoteTier(endpoint, apiKey), namespace);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

export function startServer(port: number, client: MemoryClient = buildClient()): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, client);
  });
  server.listen(port, () => console.log(`memory-mcp listening on :${port}`));
}

async function handle(req: IncomingMessage, res: ServerResponse, client: MemoryClient): Promise<void> {
  const url = req.url || "/";
  const send = (code: number, payload: unknown): void => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  };

  try {
    if (url === "/healthz") return send(200, { status: "ok" });
    if (url === "/schemas") return send(200, { tools: TOOL_SCHEMAS });

    const body = req.method === "POST" ? (JSON.parse((await readBody(req)) || "{}") as Record<string, string>) : {};
    if (url === "/recall") return send(200, { results: await client.recall(body.query || "") });
    if (url === "/prefetch") return send(200, { results: await client.prefetch(body.query || "") });
    if (url === "/write") {
      await client.write(body.content || "");
      return send(200, { ok: true });
    }
    return send(404, { error: "not found" });
  } catch (err) {
    return send(500, { error: String(err) });
  }
}

// Entry point.
startServer(Number(process.env.MEMORY_MCP_PORT ?? "9100"));
