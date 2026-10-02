import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { AgentFailure, classifyAnswer, runJaneTurn } from "./agent.js";
import { CLOSING_LINE, FALLBACK_LINE, GREETING, config } from "./config.js";
import { notifySupport } from "./email.js";
import { earlierLookups } from "./callMemory.js";
import { conversationIdForCall } from "./ids.js";
import { finalizeConversation, logTurn, markConversationError, recordTurnCount, startConversation } from "./logging.js";
import { buildTurnPrompt, type TranscriptMessage } from "./prompt.js";
import { summarizeConversation } from "./summary.js";

export const vapiRouter = Router();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Vapi sends the shared secret as a Bearer token (custom LLM) or x-vapi-secret (server URL). */
function authorized(req: Request): boolean {
  if (!config.vapiWebhookSecret) return true;
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const secret = req.header("x-vapi-secret") ?? "";
  return safeEqual(bearer, config.vapiWebhookSecret) || safeEqual(secret, config.vapiWebhookSecret);
}

vapiRouter.use((req, res, next) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

interface OpenAIMessage {
  role: string;
  content?: string | { type: string; text?: string }[] | null;
}

function messageText(content: OpenAIMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => c.text ?? "").join("");
  return "";
}

function toTranscript(messages: OpenAIMessage[]): TranscriptMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: messageText(m.content).trim() }))
    .filter((m) => m.content.length > 0);
}

/** Writes a reply in OpenAI chat-completions format, streaming deltas so Vapi can speak them as they arrive. */
class CompletionWriter {
  private readonly id = `chatcmpl-${crypto.randomUUID()}`;
  private readonly created = Math.floor(Date.now() / 1000);
  private buffered = "";
  spoken = "";
  lastWriteAt = Date.now();

  constructor(
    private readonly res: Response,
    private readonly stream: boolean,
    private readonly model: string,
  ) {}

  get open(): boolean {
    return !this.res.writableEnded && !this.res.destroyed;
  }

  private chunk(delta: object, finish: string | null): string {
    const payload = { id: this.id, object: "chat.completion.chunk", created: this.created, model: this.model, choices: [{ index: 0, delta, finish_reason: finish }] };
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  write(text: string) {
    if (!text || !this.open) return;
    this.spoken += text;
    this.lastWriteAt = Date.now();
    if (this.stream) this.res.write(this.chunk({ content: text }, null));
    else this.buffered += text;
  }

  /** Speaks a standalone sentence, separated from whatever was said before it. */
  say(sentence: string) {
    this.write(this.spoken && !/\s$/.test(this.spoken) ? ` ${sentence} ` : `${sentence} `);
  }

  end() {
    if (!this.open) return;
    if (!this.stream) {
      this.res.json({
        id: this.id,
        object: "chat.completion",
        created: this.created,
        model: this.model,
        choices: [{ index: 0, message: { role: "assistant", content: this.buffered }, finish_reason: "stop" }],
      });
      return;
    }
    this.res.write(this.chunk({}, "stop"));
    this.res.write("data: [DONE]\n\n");
    this.res.end();
  }
}

function sendCompletion(res: Response, stream: boolean, text: string, model: string) {
  const writer = new CompletionWriter(res, stream, model);
  writer.write(text);
  writer.end();
}

const HOLDING_LINES = [
  "Give me a quick moment while I check that.",
  "One moment please, let me look that up.",
  "Just a second while I get that for you.",
];
const STILL_THERE_LINES = [
  "Thanks for holding, I'm still getting that information for you.",
  "I'm still on it, thank you for your patience.",
];
const STILL_THERE_AFTER_MS = 12_000;

// ---------------------------------------------------------------------------
// Custom LLM endpoint: Vapi POSTs the whole conversation on every turn.
// Configure the Vapi assistant's Custom LLM URL as https://<webhook>/vapi
// ---------------------------------------------------------------------------
vapiRouter.post("/chat/completions", async (req, res) => {
  const started = Date.now();
  const body = req.body ?? {};
  const stream = body.stream !== false;
  const transcript = toTranscript(Array.isArray(body.messages) ? body.messages : []);

  const vapiCallId: string = body.call?.id ?? body.metadata?.vapiCallId ?? `no-call-id-${crypto.randomUUID()}`;
  if (!body.call?.id) console.warn("[vapi] request without call.id; conversation will not be linked to the widget");
  const conversationId = conversationIdForCall(vapiCallId);
  const callStart = body.call?.startedAt ?? body.call?.createdAt ?? null;
  const elapsedSeconds = callStart ? Math.max(0, Math.round((Date.now() - Date.parse(callStart)) / 1000)) : 0;

  const turnNumber = transcript.filter((m) => m.role === "user").length;
  const latestUser = [...transcript].reverse().find((m) => m.role === "user");

  // Start streaming headers immediately so Vapi sees a live response while the agent works.
  if (stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
  }

  await startConversation(conversationId, vapiCallId, callStart);

  if (!latestUser) {
    // Nothing from the caller yet (e.g. Vapi asking for an opening line).
    sendCompletion(res, stream, GREETING, config.agentModel);
    return;
  }

  // The greeting is spoken by Vapi as firstMessage; record it once as turn 0.
  if (turnNumber === 1 && transcript[0]?.role === "assistant") {
    logTurn({ conversation_id: conversationId, turn_number: 0, role: "assistant", content: transcript[0].content, answer_type: "greeting" });
  }

  const userTurnId = crypto.randomUUID();
  logTurn({ turn_id: userTurnId, conversation_id: conversationId, turn_number: turnNumber, role: "user", content: latestUser.content });
  recordTurnCount(conversationId, turnNumber);

  // Past the limit (the call should already have ended): close again without calling the agent.
  if (turnNumber > config.maxTurns || elapsedSeconds >= config.maxCallSeconds) {
    logTurn({ conversation_id: conversationId, turn_number: turnNumber, role: "assistant", content: CLOSING_LINE, answer_type: "wrap_up" });
    sendCompletion(res, stream, CLOSING_LINE, config.agentModel);
    return;
  }

  const wrapUp =
    turnNumber >= config.maxTurns ? "turn_limit" : elapsedSeconds >= config.wrapUpAfterSeconds ? "time_limit" : null;

  const abort = new AbortController();
  const writer = new CompletionWriter(res, stream, config.agentModel);
  let toolRunning = false;
  let stillThereCount = 0;
  // While a lookup runs, fill long silences so the caller knows Jane is still there.
  const silenceTimer = setInterval(() => {
    if (toolRunning && stillThereCount < STILL_THERE_LINES.length && Date.now() - writer.lastWriteAt >= STILL_THERE_AFTER_MS) {
      writer.say(STILL_THERE_LINES[stillThereCount++]);
    }
  }, 1_000);
  res.on("close", () => {
    clearInterval(silenceTimer);
    if (!res.writableEnded) abort.abort(); // caller interrupted / Vapi cancelled the turn
  });

  try {
    const prompt = buildTurnPrompt({ transcript, turnNumber, elapsedSeconds, wrapUp, earlierLookups: earlierLookups(vapiCallId) });
    const result = await runJaneTurn(prompt, { vapiCallId, conversationId, turnId: userTurnId, turnNumber }, abort, {
      onText: (delta) => {
        toolRunning = false;
        writer.write(delta);
      },
      onToolStart: () => {
        if (!writer.spoken.trim()) writer.say(HOLDING_LINES[turnNumber % HOLDING_LINES.length]);
        toolRunning = true;
      },
    });
    clearInterval(silenceTimer);

    logTurn({
      conversation_id: conversationId,
      turn_number: turnNumber,
      role: "assistant",
      content: writer.spoken.trim() || result.text,
      answer_type: wrapUp ? "wrap_up" : classifyAnswer(result),
      status: result.hadToolError ? "error" : "success",
      error_message: result.hadToolError ? "An MCP tool returned an error during this turn" : null,
      token_count_input: result.usage.inputTokens,
      token_count_output: result.usage.outputTokens,
      cache_read_tokens: result.usage.cacheReadTokens,
      cache_write_tokens: result.usage.cacheWriteTokens,
      cost_usd: result.usage.costUsd,
      latency_ms: Date.now() - started,
      model_used: result.model,
    });

    if (result.hadToolError) {
      markConversationError(conversationId, "MCP tool error during call");
      void notifySupport(
        "Jane: technical issue during a call",
        [
          ["Conversation ID", conversationId],
          ["Turn", String(turnNumber)],
          ["Customer said", latestUser.content],
        ],
        "A support tool failed during a live call. The customer was told the team will follow up.",
      );
    }

    writer.end();
  } catch (err) {
    clearInterval(silenceTimer);
    if (abort.signal.aborted && res.destroyed) {
      // Vapi dropped the request (the caller spoke over Jane); the next request carries the new turn.
      console.log(`[vapi] turn ${turnNumber} of ${conversationId} cancelled by caller interruption`);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[vapi] agent failure (conversation ${conversationId}):`, message);

    logTurn({
      conversation_id: conversationId,
      turn_number: turnNumber,
      role: "assistant",
      content: FALLBACK_LINE,
      answer_type: "fallback",
      status: "error",
      error_message: err instanceof AgentFailure ? message : `Unexpected: ${message}`,
      latency_ms: Date.now() - started,
      model_used: config.agentModel,
    });
    markConversationError(conversationId, message);
    void notifySupport(
      "Jane: backend failure during a call",
      [
        ["Conversation ID", conversationId],
        ["Vapi call ID", vapiCallId],
        ["Turn", String(turnNumber)],
        ["Customer said", latestUser.content],
        ["Error", message],
      ],
      "Jane could not respond and told the customer the support team will follow up. Please review the conversation in the admin dashboard.",
    );
    writer.say(FALLBACK_LINE);
    writer.end();
  }
});

// ---------------------------------------------------------------------------
// Server URL events (status updates, end-of-call report).
// ---------------------------------------------------------------------------
interface VapiArtifactMessage {
  role: string;
  message?: string;
  content?: string;
}

vapiRouter.post("/events", async (req, res) => {
  const message = req.body?.message ?? {};
  const callId: string | undefined = message.call?.id;
  res.status(200).json({ received: true });
  if (!callId) return;
  const conversationId = conversationIdForCall(callId);

  try {
    if (message.type === "status-update" && message.status === "in-progress") {
      await startConversation(conversationId, callId, message.call?.startedAt ?? message.call?.createdAt ?? null);
    } else if (message.type === "end-of-call-report") {
      await startConversation(conversationId, callId, message.startedAt ?? message.call?.startedAt ?? null);
      const artifactMessages: VapiArtifactMessage[] = message.artifact?.messages ?? message.messages ?? [];
      const lines = artifactMessages
        .filter((m) => m.role === "user" || m.role === "bot" || m.role === "assistant")
        .map((m) => `${m.role === "user" ? "Customer" : "Jane"}: ${(m.message ?? m.content ?? "").trim()}`)
        .filter((l) => !l.endsWith(": "));
      const transcript = lines.length ? lines.join("\n") : (message.artifact?.transcript ?? message.transcript ?? "");
      const turnCount = artifactMessages.filter((m) => m.role === "user").length;
      const summary = await summarizeConversation(transcript);
      await finalizeConversation({
        conversationId,
        summary,
        endTime: message.endedAt ?? new Date().toISOString(),
        endedReason: message.endedReason ?? null,
        turnCount,
      });
    }
  } catch (err) {
    console.error("[vapi] event handling failed:", err instanceof Error ? err.message : err);
  }
});
