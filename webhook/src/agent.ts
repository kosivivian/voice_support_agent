import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { acquireSpare, type Spare, type TurnIdentity } from "./agentPool.js";
import { rememberLookup } from "./callMemory.js";
import { config } from "./config.js";
import type { ToolTiming, TurnTimer } from "./latency.js";

export type { TurnIdentity } from "./agentPool.js";

const REMEMBERED_TOOLS = new Set(["verify_code", "lookup_transaction", "lookup_payout"]);

export interface ToolOutcome {
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
}

export interface AgentTurnResult {
  text: string;
  toolsUsed: string[];
  toolResults: ToolOutcome[];
  hadToolError: boolean;
  hadConfidentRetrieval: boolean | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
  };
  model: string;
}

export class AgentFailure extends Error {}

export interface TurnStreamHandlers {
  onText: (delta: string) => void;
  onToolStart: () => void;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("");
  }
  return "";
}

/**
 * Runs one Jane turn on a pre-started agent process. Stateless: the full
 * transcript is in `prompt`. A dead pre-started process is retried once on a
 * fresh one, as long as nothing has been streamed to the caller yet.
 */
export async function runJaneTurn(
  prompt: string,
  turn: TurnIdentity,
  signal: AbortSignal,
  handlers: TurnStreamHandlers,
  timer: TurnTimer,
): Promise<AgentTurnResult> {
  timer.mark("agent_start");
  for (let attempt = 0; ; attempt++) {
    const { spare, warm } = await acquireSpare();
    timer.warm = warm;
    timer.mark(attempt === 0 ? "spare_ready" : "retry_spare_ready");
    const state = { output: false };
    try {
      return await runOnSpare(spare, prompt, turn, signal, handlers, timer, state);
    } catch (err) {
      if (signal.aborted || state.output || !warm || attempt > 0) throw err;
      console.warn("[agent] pre-started process failed before replying; retrying on a fresh one:", err instanceof Error ? err.message : err);
    }
  }
}

async function runOnSpare(
  spare: Spare,
  prompt: string,
  turn: TurnIdentity,
  signal: AbortSignal,
  handlers: TurnStreamHandlers,
  timer: TurnTimer,
  state: { output: boolean },
): Promise<AgentTurnResult> {
  const toolsUsed: string[] = [];
  const toolResults: ToolOutcome[] = [];
  let hadToolError = false;
  let hadConfidentRetrieval: boolean | null = null;
  const pendingToolNames = new Map<string, string>();
  const pendingToolInputs = new Map<string, unknown>();
  const toolTimings = new Map<string, ToolTiming>();
  let passOutputTokens = 0;
  let streamed = "";

  spare.holder.turn = turn;
  const onAbort = () => spare.abort.abort();
  if (signal.aborted) onAbort();
  signal.addEventListener("abort", onAbort, { once: true });

  let stream: Query | null = null;
  try {
    stream = spare.warm.query(prompt);
    for await (const message of stream) {
      if (message.type === "stream_event") {
        const ev = message.event;
        if (ev.type === "message_start") {
          const u = ev.message.usage;
          timer.passStart((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
          passOutputTokens = 0;
        } else if (ev.type === "message_delta") {
          passOutputTokens = ev.usage?.output_tokens ?? passOutputTokens;
        } else if (ev.type === "message_stop") {
          timer.passEnd(passOutputTokens);
        } else if (ev.type === "content_block_stop") {
          timer.blockStop();
        } else if (ev.type === "content_block_start" && (ev.content_block.type === "thinking" || ev.content_block.type === "redacted_thinking")) {
          timer.thinkingStart();
        }
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          timer.output();
          state.output = true;
          toolTimings.set(ev.content_block.id, timer.toolEmitted(ev.content_block.name.replace(/^mcp__(relaypay|chat)__/, "")));
          handlers.onToolStart();
        } else if (ev.type === "content_block_start" && ev.content_block.type === "text" && streamed && !/\s$/.test(streamed)) {
          // Text after a tool call is a new block; keep it from running into the previous sentence.
          streamed += " ";
          handlers.onText(" ");
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          timer.output();
          timer.mark("first_text");
          state.output = true;
          streamed += ev.delta.text;
          handlers.onText(ev.delta.text);
        }
      } else if (message.type === "system" && message.subtype === "init") {
        timer.mark("sdk_init");
      } else if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            const name = block.name.replace(/^mcp__(relaypay|chat)__/, "");
            toolsUsed.push(name);
            pendingToolNames.set(block.id, name);
            pendingToolInputs.set(block.id, block.input);
            const tt = toolTimings.get(block.id);
            if (tt) tt.started = timer.now();
          }
        }
      } else if (message.type === "user" && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type !== "tool_result") continue;
          const name = pendingToolNames.get(block.tool_use_id);
          const text = toolResultText(block.content);
          const tt = toolTimings.get(block.tool_use_id);
          if (tt) tt.finished = timer.now();
          const isError = Boolean(block.is_error) || text.includes('"error":"technical_error"');
          if (isError) hadToolError = true;
          if (name) toolResults.push({ name, input: pendingToolInputs.get(block.tool_use_id), output: text, isError });
          if (name && REMEMBERED_TOOLS.has(name) && !isError && (text.includes('"found":true') || text.includes('"verified":true'))) {
            rememberLookup(turn.vapiCallId, name, pendingToolInputs.get(block.tool_use_id), text);
          }
          if (name === "retrieve_knowledge") {
            const confident = text.includes('"has_confident_match":true');
            hadConfidentRetrieval = (hadConfidentRetrieval ?? false) || confident;
          }
        }
      } else if (message.type === "result") {
        if (message.subtype !== "success" || message.is_error) {
          throw new AgentFailure(`Agent run ended with ${message.subtype}`);
        }
        const models = Object.values(message.modelUsage);
        const usage = {
          inputTokens: models.reduce((n, m) => n + m.inputTokens, 0),
          outputTokens: models.reduce((n, m) => n + m.outputTokens, 0),
          cacheReadTokens: models.reduce((n, m) => n + m.cacheReadInputTokens, 0),
          cacheWriteTokens: models.reduce((n, m) => n + m.cacheCreationInputTokens, 0),
          costUsd: message.total_cost_usd,
        };
        const text = streamed.trim() || message.result.trim();
        if (!text) throw new AgentFailure("Agent returned an empty reply");
        if (!streamed.trim()) handlers.onText(text);
        return { text, toolsUsed, toolResults, hadToolError, hadConfidentRetrieval, usage, model: config.agentModel };
      }
    }
    throw new AgentFailure("Agent stream ended without a result");
  } finally {
    signal.removeEventListener("abort", onAbort);
    spare.holder.turn = null;
    stream?.close();
  }
}

/** Best-effort label for the admin dashboard. */
export function classifyAnswer(result: Pick<AgentTurnResult, "toolsUsed" | "hadConfidentRetrieval" | "text">): string {
  const used = new Set(result.toolsUsed);
  if (used.has("create_escalation")) return "escalate";
  if (used.has("create_ticket")) return "ticket";
  if (used.has("lookup_transaction") || used.has("lookup_payout") || used.has("lookup_customer")) return "lookup";
  if (used.has("retrieve_knowledge")) return result.hadConfidentRetrieval ? "answer" : "decline";
  if (result.text.trim().endsWith("?")) return "clarify";
  return "other";
}
