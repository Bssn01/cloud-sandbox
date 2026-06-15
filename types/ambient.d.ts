// ─────────────────────────────────────────────────────────────────────────────
// Ambient stubs so the skeletons typecheck in-repo WITHOUT installing deps.
// TODO (user's machine): delete this file and install real types instead:
//   - @types/node
//   - the OpenClaw plugin SDK (provides "openclaw/plugin-sdk/*")
//   - @modelcontextprotocol/sdk (for the memory MCP transport)
// ─────────────────────────────────────────────────────────────────────────────

declare const process: {
  env: { [key: string]: string | undefined };
  exit(code?: number): void;
};
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};
declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: { [k: string]: string };
    body?: string;
  },
): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

declare module "node:http" {
  export interface IncomingMessage {
    url?: string;
    method?: string;
    on(event: "data", cb: (chunk: string) => void): void;
    on(event: "end", cb: () => void): void;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(key: string, value: string): void;
    end(data?: string): void;
  }
  export interface Server {
    listen(port: number, cb?: () => void): Server;
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server;
}

// Minimal shape of the OpenClaw plugin SDK we rely on. Reconcile with the real
// `openclaw/plugin-sdk/plugin-entry` exports before running.
declare module "openclaw/plugin-sdk/plugin-entry" {
  export type HookDecision = { allow: boolean; reason?: string };

  export interface InboundMessage {
    sessionKey: string; // canonical per-channel session id
    channel: string; // e.g. "telegram"
    senderId: string; // platform-specific sender id (checked against allowlist)
    text: string;
  }

  export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
    irreversible?: boolean;
    outwardFacing?: boolean;
    estimatedSpendUsd?: number;
  }

  export interface OpenClawPluginApi {
    pluginConfig: { [key: string]: string | undefined };
    registerTool(def: { name: string; description: string; run(args: Record<string, unknown>): Promise<string> }): void;
    lifecycle: {
      on(event: "gateway_start", handler: () => void | Promise<void>): void;
      on(event: "message_received", handler: (msg: InboundMessage) => Promise<HookDecision> | HookDecision): void;
      on(event: "before_tool_call", handler: (call: ToolCall) => Promise<HookDecision> | HookDecision): void;
    };
    // Send a message back to the originating channel/session.
    sendToChannel(sessionKey: string, text: string): Promise<void>;
  }

  export function definePlugin(spec: {
    name: string;
    register(api: OpenClawPluginApi): void | Promise<void>;
  }): unknown;
}
