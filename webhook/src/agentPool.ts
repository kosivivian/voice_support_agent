import { createSdkMcpServer, startup, tool, type Options, type WarmQuery } from "@anthropic-ai/claude-agent-sdk";
import * as z from "zod";
import { publish } from "./chatHub.js";
import { config } from "./config.js";
import { logToolCall } from "./logging.js";
import { callMcpTool, getMcpTools, type McpToolDef } from "./mcpClient.js";
import { JANE_SYSTEM_PROMPT } from "./prompt.js";

// Pool of pre-started Agent SDK processes. startup() does the slow part ahead
// of time (process spawn, config, MCP handshakes, tool registration), so a turn
// only pays for the model call. Every option is fixed at startup, so per-turn
// values (call and turn ids) reach the in-process tools through `holder`.

export interface TurnIdentity {
  vapiCallId: string;
  conversationId: string;
  turnId: string;
  turnNumber: number;
  /** Resolves once the conversation row exists; tools that write rows referencing it wait for this. */
  ready?: Promise<unknown>;
}

interface TurnHolder {
  turn: TurnIdentity | null;
}

export interface Spare {
  warm: WarmQuery;
  holder: TurnHolder;
  abort: AbortController;
  createdAt: number;
}

// The webhook logs audit events itself, so the model never spends a step on them.
const HIDDEN_FROM_MODEL = new Set(["log_conversation_event"]);

const TECHNICAL_ERROR = JSON.stringify({
  error: "technical_error",
  message: "The support system is temporarily unavailable. Tell the customer you are experiencing a technical issue and the support team will follow up.",
});

function shapeOf(def: McpToolDef): z.ZodRawShape {
  try {
    const schema = z.fromJSONSchema(def.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
    if (schema instanceof z.ZodObject) return schema.shape;
  } catch (err) {
    console.error(`[agent] could not convert input schema for ${def.name}:`, err instanceof Error ? err.message : err);
  }
  return {};
}

function relaypayProxy(holder: TurnHolder, defs: McpToolDef[], instructions?: string) {
  return createSdkMcpServer({
    name: "relaypay",
    version: "1.0.0",
    instructions,
    tools: defs.map((def) =>
      tool(
        def.name,
        def.description ?? "",
        shapeOf(def),
        async (args) => {
          const turn = holder.turn;
          if (!turn) return { content: [{ type: "text", text: TECHNICAL_ERROR }], isError: true };
          try {
            await turn.ready;
            return await callMcpTool(def.name, args, turn);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[mcp] ${def.name} failed:`, message);
            // The MCP server never saw this call, so record it here.
            logToolCall({
              conversation_id: turn.conversationId,
              turn_id: turn.turnId,
              turn_number: turn.turnNumber,
              tool_name: def.name,
              input: args,
              output: JSON.parse(TECHNICAL_ERROR),
              status: "error",
              error_message: message,
            });
            return { content: [{ type: "text", text: TECHNICAL_ERROR }], isError: true };
          }
        },
        { alwaysLoad: true, annotations: def.annotations },
      ),
    ),
  });
}

function chatServer(holder: TurnHolder) {
  return createSdkMcpServer({
    name: "chat",
    version: "1.0.0",
    tools: [
      tool(
        "send_chat_message",
        "Send information that must not be spoken aloud (transaction or payout reference numbers, account identifiers) to the caller's chat window as a short text card. One-way: the caller cannot reply through it. Say \"I'll send that to your chat window.\" in your spoken reply.",
        {
          title: z.string().describe('Short card title, e.g. "Transaction reference"'),
          body: z.string().describe("The text to show, e.g. TXN-9001"),
        },
        async ({ title, body }) => {
          const turn = holder.turn;
          if (!turn) return { content: [{ type: "text", text: TECHNICAL_ERROR }], isError: true };
          await turn.ready;
          const { delivered } = publish(turn.vapiCallId, title, body);
          const output = { sent: true, live_delivered: delivered > 0 };
          logToolCall({
            conversation_id: turn.conversationId,
            turn_id: turn.turnId,
            turn_number: turn.turnNumber,
            tool_name: "send_chat_message",
            input: { title, body },
            output,
            status: "success",
          });
          return { content: [{ type: "text", text: JSON.stringify(output) }] };
        },
        { alwaysLoad: true },
      ),
    ],
  });
}

async function createSpare(): Promise<Spare> {
  const { tools, instructions } = await getMcpTools();
  const defs = tools.filter((t) => !HIDDEN_FROM_MODEL.has(t.name));
  const holder: TurnHolder = { turn: null };
  const abort = new AbortController();
  const options: Options = {
    abortController: abort,
    model: config.agentModel,
    effort: config.agentEffort,
    thinking: config.agentThinking ? { type: "adaptive" } : { type: "disabled" },
    systemPrompt: JANE_SYSTEM_PROMPT,
    tools: [],
    allowedTools: [...defs.map((d) => `mcp__relaypay__${d.name}`), "mcp__chat__send_chat_message"],
    permissionMode: "dontAsk",
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    includePartialMessages: true,
    maxTurns: 10,
    mcpServers: { relaypay: relaypayProxy(holder, defs, instructions), chat: chatServer(holder) },
    env: { ...process.env, ANTHROPIC_API_KEY: config.anthropicApiKey, CLAUDE_AGENT_SDK_CLIENT_APP: "relaypay-jane/1.0" },
  };
  const warm = await startup({ options, initializeTimeoutMs: 30_000 });
  return { warm, holder, abort, createdAt: Date.now() };
}

const ready: Spare[] = [];
let starting = 0;

function discard(spare: Spare) {
  try {
    spare.warm.close();
  } catch {
    // already gone
  }
}

function refill() {
  while (ready.length + starting < config.agentWarmPool) {
    starting++;
    createSpare()
      .then((s) => ready.push(s))
      .catch((err) => {
        console.error("[agent] could not pre-start an agent process:", err instanceof Error ? err.message : err);
        setTimeout(refill, 5_000).unref();
      })
      .finally(() => starting--);
  }
}

/** A ready agent process: a pre-started one when available, otherwise started now. */
export async function acquireSpare(): Promise<{ spare: Spare; warm: boolean }> {
  const now = Date.now();
  let spare: Spare | undefined;
  while ((spare = ready.shift())) {
    if (now - spare.createdAt < config.agentSpareMaxAgeMs) break;
    discard(spare);
  }
  refill();
  if (spare) return { spare, warm: true };
  return { spare: await createSpare(), warm: false };
}

/** Starts the pool and replaces old spares in the background. */
export function startAgentPool() {
  refill();
  setInterval(() => {
    const cutoff = Date.now() - config.agentSpareMaxAgeMs;
    for (let i = ready.length - 1; i >= 0; i--) {
      if (ready[i].createdAt < cutoff) discard(ready.splice(i, 1)[0]);
    }
    refill();
  }, 60_000).unref();
}
