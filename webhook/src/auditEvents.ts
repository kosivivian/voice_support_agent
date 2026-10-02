import type { ToolOutcome, TurnIdentity } from "./agent.js";
import { callMcpTool } from "./mcpClient.js";

// Audit events derived from what happened in the turn and logged in the
// background through the MCP log_conversation_event tool, so the model never
// spends a step (and the caller never waits) on bookkeeping.

interface AuditEvent {
  event_type: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

function parse(output: string): Record<string, unknown> | null {
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function deriveAuditEvents(results: ToolOutcome[], wrapUp: string | null): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const r of results) {
    if (r.isError) {
      events.push({ event_type: "tool_error", summary: `${r.name} returned an error.`, metadata: { tool: r.name } });
      continue;
    }
    const out = parse(r.output);
    if (!out) continue;
    const input = (r.input ?? {}) as Record<string, unknown>;
    if (r.name === "lookup_customer") {
      events.push(
        out.found
          ? { event_type: "identity_verified", summary: `Account found for ${String(out.email ?? input.email)}.`, metadata: { customer_id: out.customer_id } }
          : { event_type: "identity_failed", summary: `No account found for ${String(input.email ?? "the given email")}.` },
      );
    } else if (r.name === "retrieve_knowledge" && out.has_confident_match === false) {
      events.push({ event_type: "declined_out_of_scope", summary: `No confident knowledge base match for "${String(input.query ?? "")}".` });
    } else if ((r.name === "lookup_transaction" || r.name === "lookup_payout") && out.found) {
      const items = (out.transactions ?? out.payouts ?? []) as { is_stale?: boolean; transaction_id?: string; payout_id?: string; status?: string }[];
      for (const item of items.filter((i) => i.is_stale)) {
        events.push({ event_type: "stale_data_detected", summary: `${item.transaction_id ?? item.payout_id} is overdue with status ${item.status}.` });
      }
    } else if (r.name === "create_escalation" && out.escalation_id) {
      events.push({ event_type: "escalation_triggered", summary: `Escalated as ${String(input.category)}: ${String(input.reason ?? "")}`, metadata: { escalation_id: out.escalation_id } });
    }
  }
  if (wrapUp) events.push({ event_type: "call_wrap_up", summary: `Session limit reached (${wrapUp}).` });
  return events;
}

export function logAuditEvents(turn: TurnIdentity, results: ToolOutcome[], wrapUp: string | null) {
  for (const event of deriveAuditEvents(results, wrapUp)) {
    callMcpTool("log_conversation_event", event, turn).catch((err) =>
      console.error("[audit] log_conversation_event failed:", err instanceof Error ? err.message : err),
    );
  }
}
