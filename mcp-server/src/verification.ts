import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";
import { sendVerificationCode } from "./email.js";

// Proof of identity = the caller can read the inbox on file. A 6-digit code is
// emailed there; the caller reads it out or types it. Verification is stored on
// the conversation row, so account tools can trust it no matter what the model says.

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_CODE = 5;
const MAX_CODES_PER_CALL = 3;
const MAX_CODES_PER_EMAIL_PER_HOUR = 5;

export const CODE_SENT_MESSAGE =
  "If this email is registered with RelayPay, a 6-digit code has just been sent to it. Ask the caller to read it out or type it in the chat, then call verify_code. Do not tell the caller whether the email was found.";

const hash = (code: string) => createHmac("sha256", config.otpSecret).update(code).digest("hex");

const normalizeEmail = (email: string) => email.trim().toLowerCase().replace(/\s+/g, "");

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};
// Sound-alikes the transcriber may produce; only used if the plain reading isn't 6 digits.
const HOMOPHONES: Record<string, string> = { o: "0", to: "2", too: "2", for: "4", ate: "8", won: "1" };

/** "one two three, four 5 six" / "123-456" -> "123456" (best 6-digit reading). */
export function normalizeSpokenCode(input: string): string {
  const words = input.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const read = (map: Record<string, string>) => words.map((w) => (/^\d+$/.test(w) ? w : map[w] ?? "")).join("");
  const candidates = [words.filter((w) => /^\d+$/.test(w)).join(""), read(DIGIT_WORDS), read({ ...DIGIT_WORDS, ...HOMOPHONES })];
  return candidates.find((c) => c.length === 6) ?? candidates[1];
}

/** The customer this conversation has proven it owns, or null. */
export async function verifiedCustomerId(conversationId: string | null): Promise<string | null> {
  if (!conversationId) return null;
  const { data } = await db.from("conversations").select("verified_customer_id").eq("conversation_id", conversationId).maybeSingle();
  return (data?.verified_customer_id as string | null) ?? null;
}

export async function accountSummary(customerId: string) {
  const { data, error } = await db
    .from("customers")
    .select("customer_id, contact_name, contact_email, company_name, plan, account_status, kyc_status, support_notes")
    .eq("customer_id", customerId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "verified customer not found");
  return {
    verified: true,
    customer_id: data.customer_id,
    name: data.contact_name,
    email: data.contact_email,
    company_name: data.company_name,
    plan: data.plan,
    account_status: data.account_status,
    kyc_status: data.kyc_status,
    support_notes: data.support_notes,
    agent_context_only: ["account_status", "kyc_status", "support_notes"],
  };
}

/** Sends a code if the email belongs to a customer. The caller-visible answer never reveals which. */
export async function issueCode(conversationId: string | null, rawEmail: string) {
  if (!conversationId) throw new Error("verification needs a conversation");
  const email = normalizeEmail(rawEmail);

  const { data: customer } = await db.from("customers").select("customer_id, contact_email").eq("contact_email", email).maybeSingle();

  // Already verified on this call for this email: no new code needed.
  const verified = await verifiedCustomerId(conversationId);
  if (verified && customer && verified === customer.customer_id) return { already_verified: true, ...(await accountSummary(verified)) };

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [{ count: callCount }, { count: emailCount }] = await Promise.all([
    db.from("verification_codes").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId),
    db.from("verification_codes").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", hourAgo),
  ]);
  if ((callCount ?? 0) >= MAX_CODES_PER_CALL || (emailCount ?? 0) >= MAX_CODES_PER_EMAIL_PER_HOUR) {
    return {
      code_sent: false,
      error: "too_many_codes",
      message: "No more codes can be sent right now. Offer to create a support ticket so the team can follow up by email.",
    };
  }

  // Calls from Jane always have a conversation row already; direct MCP clients (testing) may not.
  const { data: conv } = await db.from("conversations").select("conversation_id").eq("conversation_id", conversationId).maybeSingle();
  if (!conv) {
    const { error: convErr } = await db.from("conversations").insert({ conversation_id: conversationId, vapi_call_id: `direct-${conversationId}`, channel: "mcp" });
    if (convErr) throw new Error(convErr.message);
  }

  // A code row is stored for unknown emails too (with no customer), so the flow looks identical.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.from("verification_codes").update({ consumed_at: new Date().toISOString() }).eq("conversation_id", conversationId).is("consumed_at", null);
  const { error } = await db.from("verification_codes").insert({
    conversation_id: conversationId,
    customer_id: customer?.customer_id ?? null,
    email,
    code_hash: hash(code),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);

  if (customer) {
    // Sent in the background so the response time doesn't reveal whether the email exists.
    void sendVerificationCode(customer.contact_email, code).catch((err) =>
      console.error("[verify] code email failed:", err instanceof Error ? err.message : err),
    );
  }
  return { code_sent: true, message: CODE_SENT_MESSAGE };
}

/** Checks a code against the latest active one for this conversation. */
export async function checkCode(conversationId: string | null, rawCode: string) {
  if (!conversationId) throw new Error("verification needs a conversation");
  const code = normalizeSpokenCode(rawCode);

  const { data: row } = await db
    .from("verification_codes")
    .select("id, customer_id, code_hash, expires_at, attempts")
    .eq("conversation_id", conversationId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return { verified: false, error: "no_active_code", message: "There is no active code. Ask for the caller's email and call lookup_customer to send one." };
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    await db.from("verification_codes").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
    return { verified: false, error: "code_expired", message: "The code has expired. Offer to send a new one with lookup_customer." };
  }
  if (row.attempts >= MAX_ATTEMPTS_PER_CODE) {
    return { verified: false, error: "locked", message: "Too many wrong codes. Do not share any account details. Offer to create a support ticket." };
  }

  const given = Buffer.from(hash(code));
  const expected = Buffer.from(row.code_hash);
  const matches = code.length === 6 && row.customer_id !== null && given.length === expected.length && timingSafeEqual(given, expected);

  if (!matches) {
    const attempts = row.attempts + 1;
    await db.from("verification_codes").update({ attempts }).eq("id", row.id);
    const left = MAX_ATTEMPTS_PER_CODE - attempts;
    return left > 0
      ? { verified: false, error: "wrong_code", attempts_left: left, message: "That code is not right. Ask the caller to check the email and read the code again." }
      : { verified: false, error: "locked", message: "Too many wrong codes. Do not share any account details. Offer to create a support ticket." };
  }

  const now = new Date().toISOString();
  const summary = await accountSummary(row.customer_id as string);
  await Promise.all([
    db.from("verification_codes").update({ consumed_at: now }).eq("id", row.id),
    db
      .from("conversations")
      .update({ verified_customer_id: summary.customer_id, verified_at: now, customer_id: summary.customer_id, customer_email: summary.email })
      .eq("conversation_id", conversationId),
  ]);
  return summary;
}
