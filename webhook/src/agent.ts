import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import * as z from "zod";
import { publish } from "./chatHub.js";
import { config } from "./config.js";
import { logToolCall } from "./logging.js";
import { JANE_SYSTEM_PROMPT } from "./prompt.js";

const RELAYPAY_TOOLS = [
  "lookup_customer",
  "lookup_transaction",
  "lookup_payout",
  "retrieve_knowledge",
  "create_ticket",
  "create_escalation",
  "log_conversation_event",
].map((name) => `mcp__relaypay__${name}`);

export interface TurnIdentity {
  vapiCallId: string;
  conversationId: string;
  turnId: string;
  turnNumber: number;
}

export interface AgentTurnResult {
  text: string;
  toolsUsed: string[];
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

/** In-process tool for the one-way text push to the caller's chat widget. */
function chatServer(turn: TurnIdentity) {
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

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("");
  }
  return "";
}

/**
 * Runs one Jane turn through the Claude Agent SDK. Stateless: the full
 * transcript is in `prompt`; nothing persists between calls.
 */
export async function runJaneTurn(
  prompt: string,
  turn: TurnIdentity,
  abort: AbortController,
  handlers: TurnStreamHandlers,
): Promise<AgentTurnResult> {
  const toolsUsed: string[] = [];
  let hadToolError = false;
  let hadConfidentRetrieval: boolean | null = null;
  const pendingToolNames = new Map<string, string>();
  let streamed = "";

  const stream = query({
    prompt,
    options: {
      abortController: abort,
      model: config.agentModel,
      effort: config.agentEffort,
      systemPrompt: JANE_SYSTEM_PROMPT,
      tools: [],
      allowedTools: [...RELAYPAY_TOOLS, "mcp__chat__send_chat_message"],
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      includePartialMessages: true,
      maxTurns: 10,
      mcpServers: {
        relaypay: {
          type: "http",
          url: `${config.mcpServerUrl}/mcp`,
          headers: {
            "x-api-key": config.mcpApiKey,
            "x-conversation-id": turn.conversationId,
            "x-turn-id": turn.turnId,
            "x-turn-number": String(turn.turnNumber),
          },
          alwaysLoad: true,
          timeout: 20_000,
        },
        chat: chatServer(turn),
      },
      env: { ...process.env, ANTHROPIC_API_KEY: config.anthropicApiKey, CLAUDE_AGENT_SDK_CLIENT_APP: "relaypay-jane/1.0" },
    },
  });

  for await (const message of stream) {
    if (message.type === "stream_event") {
      const ev = message.event;
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        handlers.onToolStart();
      } else if (ev.type === "content_block_start" && ev.content_block.type === "text" && streamed && !/\s$/.test(streamed)) {
        // Text after a tool call is a new block; keep it from running into the previous sentence.
        streamed += " ";
        handlers.onText(" ");
      } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
        streamed += ev.delta.text;
        handlers.onText(ev.delta.text);
      }
    } else if (message.type === "system" && message.subtype === "init") {
      const relaypay = message.mcp_servers.find((s) => s.name === "relaypay");
      if (!relaypay || relaypay.status === "failed") {
        abort.abort();
        throw new AgentFailure(`MCP server unavailable (status: ${relaypay?.status ?? "missing"})`);
      }
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const name = block.name.replace(/^mcp__(relaypay|chat)__/, "");
          toolsUsed.push(name);
          pendingToolNames.set(block.id, name);
        }
      }
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== "tool_result") continue;
        const name = pendingToolNames.get(block.tool_use_id);
        const text = toolResultText(block.content);
        if (block.is_error || text.includes('"error":"technical_error"')) hadToolError = true;
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
      return { text, toolsUsed, hadToolError, hadConfidentRetrieval, usage, model: config.agentModel };
    }
  }
  throw new AgentFailure("Agent stream ended without a result");
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
