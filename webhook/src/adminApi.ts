import bcrypt from "bcryptjs";
import { Router, type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import * as z from "zod";
import { config } from "./config.js";
import { adminDb } from "./supabase.js";

export const adminRouter = Router();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const loginAttempts = new Map<string, number[]>();
function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const hits = (loginAttempts.get(key) ?? []).filter((t) => now - t < 15 * 60 * 1000);
  loginAttempts.set(key, hits);
  return hits.length >= 10;
}

adminRouter.post("/login", async (req, res) => {
  const parsed = z.object({ email: z.string().min(3), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const key = req.ip ?? "unknown";
  if (tooManyAttempts(key)) {
    res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const { data: user } = await adminDb.from("admin_users").select("admin_id, email, password_hash").eq("email", email).maybeSingle();
  const ok = user ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
  if (!user || !ok) {
    loginAttempts.get(key)!.push(Date.now());
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const expiresIn = config.adminSessionHours * 60 * 60;
  const token = jwt.sign({ sub: user.admin_id, email: user.email, role: "admin" }, config.adminJwtSecret, { expiresIn });
  res.json({ token, email: user.email, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
});

interface AdminClaims {
  sub: string;
  email: string;
  role: "admin";
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  try {
    const claims = jwt.verify(token, config.adminJwtSecret) as AdminClaims;
    if (claims.role !== "admin") throw new Error("wrong role");
    res.locals.admin = claims;
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

adminRouter.use(requireAdmin);

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch((err) => {
      console.error("[admin]", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
    });

function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

const limitOf = (req: Request, fallback = 200) => Math.min(Number(req.query.limit) || fallback, 1000);

adminRouter.get("/me", (_req, res) => {
  res.json({ email: (res.locals.admin as AdminClaims).email });
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
adminRouter.get(
  "/conversations",
  wrap(async (req, res) => {
    const rows = must(
      await adminDb
        .from("conversations")
        .select("conversation_id, vapi_call_id, channel, customer_id, customer_email, start_time, end_time, status, turn_count, summary, error_message, ended_reason")
        .order("start_time", { ascending: false })
        .limit(limitOf(req)),
    );
    res.json(rows);
  }),
);

adminRouter.get(
  "/conversations/:id",
  wrap(async (req, res) => {
    const id = req.params.id;
    const [conversation, turns, toolCalls, retrievals, events, tickets, escalations] = await Promise.all([
      adminDb.from("conversations").select("*").eq("conversation_id", id).maybeSingle(),
      adminDb.from("turns").select("*").eq("conversation_id", id).order("turn_number").order("created_at"),
      adminDb.from("tool_calls").select("*").eq("conversation_id", id).order("created_at"),
      adminDb.from("retrieval_logs").select("*").eq("conversation_id", id).order("created_at"),
      adminDb.from("conversation_events").select("*").eq("conversation_id", id).order("created_at"),
      adminDb.from("tickets").select("*").eq("conversation_id", id).order("created_at"),
      adminDb.from("escalations").select("*").eq("conversation_id", id).order("created_at"),
    ]);
    const conv = must(conversation);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({
      conversation: conv,
      turns: must(turns),
      tool_calls: must(toolCalls),
      retrieval_logs: must(retrievals),
      events: must(events),
      tickets: must(tickets),
      escalations: must(escalations),
    });
  }),
);

// ---------------------------------------------------------------------------
// Tickets, escalations, retrieval logs
// ---------------------------------------------------------------------------
// Escalated tickets are urgent: they come first, newest first within each group.
adminRouter.get(
  "/tickets",
  wrap(async (req, res) => {
    const rows = must(
      await adminDb
        .from("tickets")
        .select("*, escalations(escalation_id, category, status, preferred_time)")
        .order("created_at", { ascending: false })
        .limit(limitOf(req)),
    ) as ({ escalations: unknown[] | null } & Record<string, unknown>)[];
    const withFlags = rows.map((t) => ({ ...t, urgent: (t.escalations?.length ?? 0) > 0 }));
    withFlags.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    res.json(withFlags);
  }),
);

const TICKET_TO_ESCALATION_STATUS = { open: "open", processing: "in_progress", resolved: "closed" } as const;

adminRouter.patch(
  "/tickets/:id",
  wrap(async (req, res) => {
    const parsed = z.object({ status: z.enum(["open", "processing", "resolved"]) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "status must be open, processing or resolved" });
      return;
    }
    const { status } = parsed.data;
    const ticket = must(await adminDb.from("tickets").update({ status }).eq("ticket_id", req.params.id).select("*").single());
    // Keep the linked escalation in step so both views agree.
    must(await adminDb.from("escalations").update({ status: TICKET_TO_ESCALATION_STATUS[status] }).eq("ticket_id", req.params.id).select("escalation_id"));
    res.json(ticket);
  }),
);

adminRouter.get(
  "/escalations",
  wrap(async (req, res) => {
    res.json(must(await adminDb.from("escalations").select("*").order("created_at", { ascending: false }).limit(limitOf(req))));
  }),
);

adminRouter.get(
  "/retrieval-logs",
  wrap(async (req, res) => {
    res.json(must(await adminDb.from("retrieval_logs").select("*").order("created_at", { ascending: false }).limit(limitOf(req))));
  }),
);

// ---------------------------------------------------------------------------
// Evaluations (the only table admins edit)
// ---------------------------------------------------------------------------
const evaluationSchema = z.object({
  scenario_number: z.number().int().nullable().optional(),
  scenario_name: z.string().trim().min(1),
  tester_name: z.string().trim().nullable().optional(),
  date_run: z.string().nullable().optional(),
  conversation_id: z.uuid().nullable().optional(),
  expected_behavior: z.string().trim().min(1),
  actual_behavior: z.string().nullable().optional(),
  result: z.enum(["pass", "fail"]).nullable().optional(),
  notes: z.string().nullable().optional(),
});

adminRouter.get(
  "/evaluations",
  wrap(async (_req, res) => {
    res.json(
      must(
        await adminDb
          .from("evaluations")
          .select("*")
          .order("scenario_number", { ascending: true, nullsFirst: false })
          .order("created_at"),
      ),
    );
  }),
);

adminRouter.post(
  "/evaluations",
  wrap(async (req, res) => {
    const parsed = evaluationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    res.status(201).json(must(await adminDb.from("evaluations").insert(parsed.data).select("*").single()));
  }),
);

adminRouter.patch(
  "/evaluations/:id",
  wrap(async (req, res) => {
    const parsed = evaluationSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    res.json(
      must(await adminDb.from("evaluations").update(parsed.data).eq("evaluation_id", req.params.id).select("*").single()),
    );
  }),
);

// ---------------------------------------------------------------------------
// Metrics, costs, errors
// ---------------------------------------------------------------------------
// USD per million tokens. Used when a turn has no SDK-reported cost.
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

interface CostTurn {
  conversation_id: string;
  model_used: string | null;
  token_count_input: number | null;
  token_count_output: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
}

function turnCost(t: CostTurn): number {
  if (t.cost_usd != null) return Number(t.cost_usd);
  const p = t.model_used ? PRICING[t.model_used] : undefined;
  if (!p) return 0;
  return (
    ((t.token_count_input ?? 0) * p.input +
      (t.token_count_output ?? 0) * p.output +
      (t.cache_read_tokens ?? 0) * p.cacheRead +
      (t.cache_write_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

adminRouter.get(
  "/metrics",
  wrap(async (_req, res) => {
    const convs = must(
      await adminDb.from("conversations").select("status, turn_count, start_time, end_time"),
    ) as { status: string; turn_count: number; start_time: string; end_time: string | null }[];
    const total = convs.length;
    const count = (s: string) => convs.filter((c) => c.status === s).length;
    const finished = convs.filter((c) => c.end_time);
    const durations = finished.map((c) => (Date.parse(c.end_time!) - Date.parse(c.start_time)) / 1000).filter((d) => d >= 0);
    const [tickets, escalations] = await Promise.all([
      adminDb.from("tickets").select("*", { count: "exact", head: true }),
      adminDb.from("escalations").select("*", { count: "exact", head: true }),
    ]);
    const rate = (n: number) => (total ? n / total : 0);
    res.json({
      total_conversations: total,
      active: count("active"),
      resolved: count("resolved"),
      escalated: count("escalated"),
      errors: count("error"),
      resolution_rate: rate(count("resolved")),
      escalation_rate: rate(count("escalated")),
      error_rate: rate(count("error")),
      avg_turns: total ? convs.reduce((n, c) => n + (c.turn_count ?? 0), 0) / total : 0,
      avg_duration_seconds: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      total_tickets: tickets.count ?? 0,
      total_escalations: escalations.count ?? 0,
    });
  }),
);

adminRouter.get(
  "/costs",
  wrap(async (_req, res) => {
    const turns = must(
      await adminDb
        .from("turns")
        .select("conversation_id, model_used, token_count_input, token_count_output, cache_read_tokens, cache_write_tokens, cost_usd")
        .eq("role", "assistant")
        .not("model_used", "is", null),
    ) as CostTurn[];

    const byConversation = new Map<string, { conversation_id: string; turns: number; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number }>();
    const byModel = new Map<string, { model: string; turns: number; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number }>();
    for (const t of turns) {
      const cost = turnCost(t);
      const add = <T extends { turns: number; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number }>(row: T) => {
        row.turns += 1;
        row.input += t.token_count_input ?? 0;
        row.output += t.token_count_output ?? 0;
        row.cache_read += t.cache_read_tokens ?? 0;
        row.cache_write += t.cache_write_tokens ?? 0;
        row.cost_usd += cost;
      };
      const c = byConversation.get(t.conversation_id) ?? { conversation_id: t.conversation_id, turns: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0 };
      add(c);
      byConversation.set(t.conversation_id, c);
      const model = t.model_used ?? "unknown";
      const m = byModel.get(model) ?? { model, turns: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0 };
      add(m);
      byModel.set(model, m);
    }
    const models = [...byModel.values()];
    res.json({
      by_model: models,
      by_conversation: [...byConversation.values()].sort((a, b) => b.cost_usd - a.cost_usd),
      totals: {
        turns: models.reduce((n, m) => n + m.turns, 0),
        input: models.reduce((n, m) => n + m.input, 0),
        output: models.reduce((n, m) => n + m.output, 0),
        cache_read: models.reduce((n, m) => n + m.cache_read, 0),
        cache_write: models.reduce((n, m) => n + m.cache_write, 0),
        cost_usd: models.reduce((n, m) => n + m.cost_usd, 0),
      },
      note: "Agent turn costs are the Claude Agent SDK's estimate. Call summaries are not included.",
    });
  }),
);

adminRouter.get(
  "/errors",
  wrap(async (_req, res) => {
    const [convs, turns, tools] = await Promise.all([
      adminDb.from("conversations").select("conversation_id, start_time, error_message, customer_email").eq("status", "error").order("start_time", { ascending: false }),
      adminDb.from("turns").select("turn_id, conversation_id, turn_number, content, error_message, created_at").eq("status", "error").order("created_at", { ascending: false }),
      adminDb.from("tool_calls").select("tool_call_id, conversation_id, turn_number, tool_name, input, error_message, created_at").eq("status", "error").order("created_at", { ascending: false }),
    ]);
    res.json({ conversations: must(convs), turns: must(turns), tool_calls: must(tools) });
  }),
);
