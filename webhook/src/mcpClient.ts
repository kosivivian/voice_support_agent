import http from "node:http";
import https from "node:https";
import { config } from "./config.js";

// Long-lived client for the RelayPay MCP server. One keep-alive connection
// pool for the whole process; tool definitions are fetched once and cached.
// The server is stateless, so each tools/call is a single POST.

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; [k: string]: unknown };
}

export interface ToolContext {
  conversationId: string;
  turnId: string;
  turnNumber: number;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const base = new URL(config.mcpServerUrl.replace(/\/+$/, ""));
const isHttps = base.protocol === "https:";
const agent = isHttps
  ? new https.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 32 })
  : new http.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 32 });

let nextId = 1;

function request(method: "GET" | "POST", path: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; type: string; text: string }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      {
        agent,
        method,
        hostname: base.hostname,
        port: base.port || (isHttps ? 443 : 80),
        path,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          Accept: "application/json, text/event-stream",
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`MCP request timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function rpc<T>(method: string, params: unknown, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<T> {
  const res = await request("POST", "/mcp", { jsonrpc: "2.0", id: nextId++, method, params }, { "x-api-key": config.mcpApiKey, ...headers }, timeoutMs);
  if (res.status === 401) throw new Error("MCP server rejected MCP_API_KEY");
  if (res.status >= 400) throw new Error(`MCP server returned ${res.status}`);
  // Responses come as JSON or as a single server-sent event.
  const raw = res.type.includes("text/event-stream")
    ? res.text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() ?? ""
    : res.text;
  const msg = JSON.parse(raw) as { result?: T; error?: { message: string } };
  if (msg.error) throw new Error(`MCP ${method} failed: ${msg.error.message}`);
  return msg.result as T;
}

let toolsPromise: Promise<{ tools: McpToolDef[]; instructions?: string }> | null = null;
let lastStatus = "not checked yet";

/** Whether the MCP server was reachable the last time the tools were fetched. */
export function mcpStatus(): string {
  return lastStatus;
}

/** Tool definitions and server instructions, fetched once per process (retried after a failure). */
export function getMcpTools(): Promise<{ tools: McpToolDef[]; instructions?: string }> {
  toolsPromise ??= (async () => {
    const init = await rpc<{ instructions?: string }>("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "relaypay-webhook", version: "1.0.0" },
    });
    const { tools } = await rpc<{ tools: McpToolDef[] }>("tools/list", {});
    console.log(`[mcp] cached ${tools.length} tool definitions from ${base.origin}`);
    lastStatus = `ok (${tools.length} tools)`;
    return { tools, instructions: init.instructions };
  })().catch((err) => {
    toolsPromise = null;
    lastStatus = `unreachable at ${base.origin}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[mcp] ${lastStatus}`);
    throw err;
  });
  return toolsPromise;
}

export async function callMcpTool(name: string, args: unknown, ctx: ToolContext): Promise<McpToolResult> {
  return rpc<McpToolResult>("tools/call", { name, arguments: args }, {
    "x-conversation-id": ctx.conversationId,
    "x-turn-id": ctx.turnId,
    "x-turn-number": String(ctx.turnNumber),
  });
}

/** Pings the server periodically so a pooled connection is ready when the next turn needs it. */
export function keepMcpConnectionWarm(intervalMs = 20_000) {
  const ping = () => request("GET", "/health", undefined, {}, 5_000).catch(() => undefined);
  void ping();
  setInterval(ping, intervalMs).unref();
}
