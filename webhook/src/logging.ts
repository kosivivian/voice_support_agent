import { anonDb } from "./supabase.js";

// Every write on the call path is fire-and-forget: a logging failure is
// reported to the console and never aborts or delays the call.

function report(what: string) {
  return ({ error }: { error: { message: string } | null }) => {
    if (error) console.error(`[log] ${what} failed:`, error.message);
  };
}

export interface TurnRecord {
  turn_id?: string;
  conversation_id: string;
  turn_number: number;
  role: "user" | "assistant";
  content: string;
  answer_type?: string | null;
  status?: "success" | "error";
  error_message?: string | null;
  token_count_input?: number | null;
  token_count_output?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  cost_usd?: number | null;
  latency_ms?: number | null;
  model_used?: string | null;
}

export function logTurn(turn: TurnRecord) {
  anonDb.from("turns").insert(turn).then(report("turns insert"));
}

export function logToolCall(row: {
  conversation_id: string;
  turn_id: string | null;
  turn_number: number;
  tool_name: string;
  input: unknown;
  output: unknown;
  status: "success" | "error";
  error_message?: string | null;
}) {
  anonDb.from("tool_calls").insert(row).then(report("tool_calls insert"));
}

/** Awaited (briefly) so the conversation row exists before MCP tools reference it. */
export async function startConversation(conversationId: string, vapiCallId: string, startTime?: string | null) {
  const timeout = new Promise<{ error: { message: string } }>((resolve) =>
    setTimeout(() => resolve({ error: { message: "timed out after 2s" } }), 2000),
  );
  const rpc = anonDb.rpc("start_conversation", {
    p_conversation_id: conversationId,
    p_vapi_call_id: vapiCallId,
    p_start_time: startTime ?? new Date().toISOString(),
  });
  report("start_conversation")(await Promise.race([rpc, timeout]));
}

export function recordTurnCount(conversationId: string, turnCount: number) {
  anonDb.rpc("record_turn_count", { p_conversation_id: conversationId, p_turn_count: turnCount }).then(report("record_turn_count"));
}

export function markConversationError(conversationId: string, message: string) {
  anonDb.rpc("mark_conversation_error", { p_conversation_id: conversationId, p_error: message }).then(report("mark_conversation_error"));
}

export async function finalizeConversation(args: {
  conversationId: string;
  summary: string;
  endTime: string | null;
  endedReason: string | null;
  turnCount: number;
}) {
  report("finalize_conversation")(
    await anonDb.rpc("finalize_conversation", {
      p_conversation_id: args.conversationId,
      p_summary: args.summary,
      p_end_time: args.endTime,
      p_ended_reason: args.endedReason,
      p_turn_count: args.turnCount,
    }),
  );
}
