import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod";
import { config } from "./config.js";
import { db } from "./db.js";
import { sendEscalationEmail } from "./email.js";
import { embedQuery } from "./voyage.js";

/** Per-request call context, set by the webhook server in request headers. */
export interface CallContext {
  conversationId: string | null;
  turnId: string | null;
  turnNumber: number | null;
}

export const ESCALATION_CATEGORIES = [
  "account",
  "compliance",
  "dispute",
  "refund",
  "cancellation",
  "frustrated_customer",
  "unresolved",
  "stale_data",
  "technical_error",
] as const;

const STALE_STATUSES = new Set(["processing", "delayed", "review required"]);

/** Today's date in West African Time (UTC+1) as YYYY-MM-DD. */
function todayWAT(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isStale(status: string, estimatedArrival: string | null): boolean {
  if (!estimatedArrival) return false;
  return STALE_STATUSES.has(status.toLowerCase()) && estimatedArrival < todayWAT();
}

function guidanceFor(status: string, stale: boolean): string {
  const s = status.toLowerCase();
  if (s === "review required") {
    return "UNDER REVIEW: tell the caller it is currently under review by our team. Do not explain, speculate about, or give a timeline for the review. Then ask whether they would like a specialist to follow up; only if they say yes, create a ticket and then an escalation with category compliance.";
  }
  if (s === "failed") {
    return "FAILED: tell the caller it failed and give the customer-safe reason (support_summary or failure_reason) in your own words. Then ask whether they would like a support ticket so the team can help sort it out; only if they say yes, create a ticket.";
  }
  if (stale) {
    return "OVERDUE: tell the caller the current status and that the estimated arrival date on record has passed, so it is taking longer than expected. Do not repeat support_summary wording that says it is within a normal window. Then ask whether they would like a specialist to look into it; only if they say yes, create a ticket and then an escalation with category stale_data.";
  }
  return "ON TRACK: tell the caller the status and the support_summary in your own words. If they ask when it will arrive, give the estimated_arrival date on record and do not promise anything beyond it. Do not offer a ticket or escalation unless the caller asks for one.";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null);

function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], isError };
}

/** Fire-and-forget tool-call log. A logging failure never fails the tool. */
function logToolCall(
  ctx: CallContext,
  toolName: string,
  input: unknown,
  output: unknown,
  status: "success" | "error",
  durationMs: number,
  errorMessage?: string,
) {
  db.from("tool_calls")
    .insert({
      conversation_id: ctx.conversationId,
      turn_id: ctx.turnId,
      turn_number: ctx.turnNumber,
      tool_name: toolName,
      input,
      output,
      status,
      error_message: errorMessage ?? null,
      duration_ms: durationMs,
    })
    .then(({ error }) => {
      if (error) console.error(`[log] tool_calls insert failed for ${toolName}:`, error.message);
    });
}

/** Wraps a tool handler with timing, structured errors and tool-call logging. */
function instrument<A>(ctx: CallContext, toolName: string, fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    const started = Date.now();
    try {
      const output = await fn(args);
      logToolCall(ctx, toolName, args, output, "success", Date.now() - started);
      return json(output);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[tool] ${toolName} failed:`, message);
      const output = {
        error: "technical_error",
        message: "The support system is temporarily unavailable. Tell the customer you are experiencing a technical issue and the support team will follow up.",
      };
      logToolCall(ctx, toolName, args, output, "error", Date.now() - started, message);
      return json(output, true);
    }
  };
}

async function customerExists(customerId: string | undefined | null): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await db.from("customers").select("customer_id").eq("customer_id", customerId).maybeSingle();
  return data?.customer_id ?? null;
}

export function buildServer(ctx: CallContext): McpServer {
  const server = new McpServer(
    { name: "relaypay-support", version: "1.0.0" },
    {
      instructions:
        "RelayPay support tools for Jane. Verify the caller by email with lookup_customer before any account, transaction or payout lookup. Fields marked agent-context-only must never be spoken.",
    },
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "lookup_customer",
    {
      title: "Look up customer",
      description:
        "Find a RelayPay customer by their email address (the only identity signal). Call this before any account, transaction or payout lookup. company_name is optional supporting context and can never trigger a lookup on its own. account_status, kyc_status and support_notes are AGENT CONTEXT ONLY and must never be spoken; only the email and plan may be read back for confirmation.",
      inputSchema: z.object({
        email: z.string().describe("Customer's email address as given by the caller"),
        company_name: z.string().optional().describe("Company name if the caller volunteered it"),
      }),
    },
    instrument(ctx, "lookup_customer", async ({ email, company_name }: { email: string; company_name?: string }) => {
      const normalized = email.trim().toLowerCase().replace(/\s+/g, "");
      const { data, error } = await db
        .from("customers")
        .select("customer_id, contact_name, contact_email, company_name, plan, account_status, kyc_status, support_notes")
        .eq("contact_email", normalized)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        return {
          found: false,
          message: "No customer account matches that email. Tell the caller you cannot find an account with that email and offer to create a ticket.",
        };
      }

      if (ctx.conversationId) {
        db.from("conversations")
          .update({ customer_id: data.customer_id, customer_email: data.contact_email })
          .eq("conversation_id", ctx.conversationId)
          .then(({ error: e }) => e && console.error("[log] conversation customer update failed:", e.message));
      }

      return {
        found: true,
        customer_id: data.customer_id,
        name: data.contact_name,
        email: data.contact_email,
        company_name: data.company_name,
        company_name_matches:
          company_name === undefined ? null : company_name.trim().toLowerCase() === data.company_name.toLowerCase(),
        plan: data.plan,
        account_status: data.account_status,
        kyc_status: data.kyc_status,
        support_notes: data.support_notes,
        speakable_fields: ["email", "plan"],
        next_step: `Confirm back: "I've found your account under ${data.contact_email} on the ${data.plan} plan — is that correct?" Proceed only after the caller confirms.`,
      };
    }),
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "lookup_transaction",
    {
      title: "Look up transaction",
      description:
        "Look up a transaction for a VERIFIED customer. Requires the customer_id returned by lookup_customer. transaction_reference is the reference the caller gives (e.g. TXN-9001); omit it to list the customer's recent transactions. Each result includes is_stale and agent_guidance — follow agent_guidance exactly. Never read reference numbers aloud; push them to the chat window instead.",
      inputSchema: z.object({
        customer_id: z.string().describe("customer_id from lookup_customer"),
        transaction_reference: z.string().optional().describe("Transaction reference, e.g. TXN-9001"),
      }),
    },
    instrument(
      ctx,
      "lookup_transaction",
      async ({ customer_id, transaction_reference }: { customer_id: string; transaction_reference?: string }) => {
        let query = db
          .from("transactions")
          .select("transaction_id, transaction_type, amount, currency, destination_country, status, created_at, estimated_arrival, support_summary")
          .eq("customer_id", customer_id)
          .order("created_at", { ascending: false })
          .limit(5);
        if (transaction_reference) {
          query = query.eq("transaction_id", transaction_reference.trim().toUpperCase().replace(/\s+/g, ""));
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          return {
            found: false,
            message: transaction_reference
              ? "No transaction with that reference exists on this customer's account. Ask the caller to double-check the reference, or offer a ticket."
              : "This customer has no transactions on record.",
          };
        }
        const transactions = data.map((t) => {
          const stale = isStale(t.status, t.estimated_arrival);
          return {
            transaction_id: t.transaction_id,
            reference: t.transaction_id,
            type: t.transaction_type,
            amount: Number(t.amount),
            currency: t.currency,
            status: t.status,
            corridor: t.destination_country,
            estimated_arrival: t.estimated_arrival,
            created_at: t.created_at,
            support_summary: t.support_summary,
            is_stale: stale,
            agent_guidance: guidanceFor(t.status, stale),
          };
        });
        return { found: true, today_wat: todayWAT(), transactions };
      },
    ),
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "lookup_payout",
    {
      title: "Look up payout",
      description:
        "Look up a contractor/vendor payout for a VERIFIED customer. Requires the customer_id returned by lookup_customer. payout_reference is the reference the caller gives (e.g. PAY-7001); omit it to list the customer's recent payouts. The same stale-data rule as transactions applies — follow agent_guidance exactly.",
      inputSchema: z.object({
        customer_id: z.string().describe("customer_id from lookup_customer"),
        payout_reference: z.string().optional().describe("Payout reference, e.g. PAY-7001"),
      }),
    },
    instrument(ctx, "lookup_payout", async ({ customer_id, payout_reference }: { customer_id: string; payout_reference?: string }) => {
      let query = db
        .from("payouts")
        .select("payout_id, transaction_id, recipient_name, amount, currency, status, scheduled_for, failure_reason, created_at, transactions(destination_country)")
        .eq("customer_id", customer_id)
        .order("scheduled_for", { ascending: false })
        .limit(5);
      if (payout_reference) {
        query = query.eq("payout_id", payout_reference.trim().toUpperCase().replace(/\s+/g, ""));
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        return {
          found: false,
          message: payout_reference
            ? "No payout with that reference exists on this customer's account. Ask the caller to double-check the reference, or offer a ticket."
            : "This customer has no payouts on record.",
        };
      }
      const payouts = data.map((p) => {
        const stale = isStale(p.status, p.scheduled_for);
        const linked = p.transactions as unknown as { destination_country: string | null } | null;
        return {
          payout_id: p.payout_id,
          reference: p.payout_id,
          linked_transaction: p.transaction_id,
          recipient_name: p.recipient_name,
          amount: Number(p.amount),
          currency: p.currency,
          status: p.status,
          destination_country: linked?.destination_country ?? null,
          estimated_arrival: p.scheduled_for,
          failure_reason: p.failure_reason,
          created_at: p.created_at,
          is_stale: stale,
          agent_guidance: guidanceFor(p.status, stale),
        };
      });
      return { found: true, today_wat: todayWAT(), payouts };
    }),
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "retrieve_knowledge",
    {
      title: "Retrieve approved knowledge",
      description:
        "Semantic search over RelayPay's approved knowledge base. Call this before answering ANY product, fee, timeline or policy question. Answer only from chunks where confident is true; if has_confident_match is false, the topic is outside the knowledge base — say you can't help with that specific topic and offer a ticket.",
      inputSchema: z.object({
        query: z.string().describe("The customer's question, rephrased as a clear search query"),
        top_k: z.number().int().min(1).max(8).optional().describe("Number of chunks to return (default 3)"),
      }),
    },
    instrument(ctx, "retrieve_knowledge", async ({ query, top_k }: { query: string; top_k?: number }) => {
      const embedding = await embedQuery(query);
      const { data, error } = await db.rpc("match_knowledge", {
        query_embedding: JSON.stringify(embedding),
        match_count: top_k ?? 3,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { chunk_id: string; source_title: string; content: string; similarity: number }[];
      const threshold = config.similarityThreshold;

      const chunks = rows.map((r) => {
        const confident = r.similarity >= threshold;
        return {
          chunk_id: r.chunk_id,
          source_title: r.source_title,
          similarity_score: Number(r.similarity.toFixed(4)),
          confident,
          // Low-confidence content is withheld so it cannot be used to answer.
          content: confident ? r.content : null,
        };
      });
      const hasConfidentMatch = chunks.some((c) => c.confident);

      const top = rows[0];
      const sourceSummary = top
        ? `${hasConfidentMatch ? "Grounded" : "Below threshold"}: ${rows.map((r) => r.source_title).join("; ")} — ${top.content.replace(/\s+/g, " ").slice(0, 160)}`
        : "No chunks returned";

      db.from("retrieval_logs")
        .insert({
          conversation_id: ctx.conversationId,
          turn_id: ctx.turnId,
          turn_number: ctx.turnNumber,
          query,
          chunks_returned: rows.map((r) => ({
            chunk_id: r.chunk_id,
            source_title: r.source_title,
            similarity: r.similarity,
            content: r.content,
          })),
          source_titles: rows.map((r) => r.source_title),
          similarity_scores: rows.map((r) => r.similarity),
          source_summary: sourceSummary,
          above_threshold: hasConfidentMatch,
        })
        .then(({ error: e }) => e && console.error("[log] retrieval_logs insert failed:", e.message));

      return { threshold, has_confident_match: hasConfidentMatch, chunks };
    }),
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "create_ticket",
    {
      title: "Create support ticket",
      description:
        "Create a support ticket for human follow-up. Use on its own for non-urgent issues (e.g. a failed invoice payment to investigate, a question outside the knowledge base). ALWAYS call this first when escalating — pass the returned ticket_id to create_escalation. Collect the caller's name and email before calling.",
      inputSchema: z.object({
        conversation_id: z.string().optional().describe("Ignored if the server already knows the conversation"),
        customer_id: z.string().optional().describe("customer_id from lookup_customer, if verified"),
        user_name: z.string().describe("Caller's name"),
        user_email: z.string().describe("Caller's email"),
        subject: z.string().describe("Short subject line"),
        description: z.string().describe("What the customer needs and what has been discussed so far"),
        category: z
          .string()
          .optional()
          .describe("e.g. payment, invoice, payout, account, compliance, dispute, refund, cancellation, general, unresolved"),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      }),
    },
    instrument(
      ctx,
      "create_ticket",
      async (args: {
        conversation_id?: string;
        customer_id?: string;
        user_name: string;
        user_email: string;
        subject: string;
        description: string;
        category?: string;
        priority?: "low" | "normal" | "high" | "urgent";
      }) => {
        const row = {
          conversation_id: ctx.conversationId ?? asUuid(args.conversation_id),
          customer_id: await customerExists(args.customer_id),
          source: "voice",
          user_name: args.user_name,
          user_email: args.user_email.trim().toLowerCase(),
          subject: args.subject,
          description: args.description,
          category: args.category ?? null,
          priority: args.priority ?? "normal",
        };
        let { data, error } = await db.from("tickets").insert(row).select("ticket_id, created_at, status").single();
        if (error?.code === "23503" && row.conversation_id) {
          // Conversation row not written yet (logging is async) — keep the ticket anyway.
          ({ data, error } = await db
            .from("tickets")
            .insert({ ...row, conversation_id: null })
            .select("ticket_id, created_at, status")
            .single());
        }
        if (error || !data) throw new Error(error?.message ?? "ticket insert returned no row");
        return { ticket_id: data.ticket_id, created_at: data.created_at, status: data.status };
      },
    ),
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "create_escalation",
    {
      title: "Create escalation",
      description:
        "Escalate an urgent, sensitive or regulated issue to the customer support team, which emails them immediately. ticket_id is REQUIRED — call create_ticket first. After this succeeds, tell the customer a specialist will follow up and do not attempt further resolution. Never reveal the category or internal notes to the customer.",
      inputSchema: z.object({
        ticket_id: z.string().describe("ticket_id returned by create_ticket"),
        conversation_id: z.string().optional().describe("Ignored if the server already knows the conversation"),
        customer_id: z.string().optional(),
        user_name: z.string(),
        user_email: z.string(),
        category: z.enum(ESCALATION_CATEGORIES),
        reason: z
          .string()
          .describe("Why this is escalated. Note here if the caller appears to be outside WAT (UTC+1) based on the time they gave."),
        preferred_time: z.string().optional().describe('Callback time exactly as the caller said it, e.g. "tomorrow at 9am"'),
      }),
    },
    instrument(
      ctx,
      "create_escalation",
      async (args: {
        ticket_id: string;
        conversation_id?: string;
        customer_id?: string;
        user_name: string;
        user_email: string;
        category: (typeof ESCALATION_CATEGORIES)[number];
        reason: string;
        preferred_time?: string;
      }) => {
        const ticketId = asUuid(args.ticket_id);
        const { data: ticket } = ticketId
          ? await db.from("tickets").select("ticket_id, conversation_id").eq("ticket_id", ticketId).maybeSingle()
          : { data: null };
        if (!ticket) {
          return { error: "invalid_ticket", message: "ticket_id not found. Call create_ticket first and use the ticket_id it returns." };
        }

        const conversationId = ctx.conversationId ?? ticket.conversation_id ?? asUuid(args.conversation_id);
        const { data, error } = await db
          .from("escalations")
          .insert({
            ticket_id: ticket.ticket_id,
            conversation_id: ticket.conversation_id ?? null,
            customer_id: await customerExists(args.customer_id),
            user_name: args.user_name,
            user_email: args.user_email.trim().toLowerCase(),
            category: args.category,
            reason: args.reason,
            preferred_time: args.preferred_time ?? null,
            call_booked: Boolean(args.preferred_time),
          })
          .select("escalation_id, created_at, status")
          .single();
        if (error || !data) throw new Error(error?.message ?? "escalation insert returned no row");

        if (conversationId) {
          const { error: convErr } = await db
            .from("conversations")
            .update({ status: "escalated" })
            .eq("conversation_id", conversationId);
          if (convErr) console.error("[log] conversation status update failed:", convErr.message);
        }

        const sent = await sendEscalationEmail({
          customerName: args.user_name,
          customerEmail: args.user_email,
          conversationId,
          ticketId: ticket.ticket_id,
          escalationId: data.escalation_id,
          category: args.category,
          reason: args.reason,
          preferredTime: args.preferred_time ?? null,
        });
        if (sent) {
          await db.from("escalations").update({ notified_at: new Date().toISOString() }).eq("escalation_id", data.escalation_id);
        }

        return {
          escalation_id: data.escalation_id,
          created_at: data.created_at,
          status: data.status,
          support_team_notified: sent,
          follow_up_summary: args.preferred_time
            ? `A specialist will follow up; the caller asked for a callback ${args.preferred_time}.`
            : "A specialist will follow up by email or phone.",
        };
      },
    ),
  );

  // -------------------------------------------------------------------------
  server.registerTool(
    "log_conversation_event",
    {
      title: "Log conversation event",
      description:
        "Record an important agent decision for audit, e.g. identity_verified, identity_failed, clarification_requested, declined_out_of_scope, stale_data_detected, escalation_triggered, call_wrap_up. Do not use for routine chit-chat.",
      inputSchema: z.object({
        conversation_id: z.string().optional().describe("Ignored if the server already knows the conversation"),
        event_type: z.string(),
        summary: z.string(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    instrument(
      ctx,
      "log_conversation_event",
      async (args: { conversation_id?: string; event_type: string; summary: string; metadata?: Record<string, unknown> }) => {
        const { error } = await db.from("conversation_events").insert({
          conversation_id: ctx.conversationId ?? asUuid(args.conversation_id),
          turn_number: ctx.turnNumber,
          event_type: args.event_type,
          summary: args.summary,
          metadata: args.metadata ?? {},
        });
        if (error) throw new Error(error.message);
        return { logged: true };
      },
    ),
  );

  return server;
}
