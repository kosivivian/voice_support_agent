import { Resend } from "resend";
import { config } from "./config.js";
import { db } from "./db.js";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

/** Active customer-support staff email, falling back to SUPPORT_EMAIL. */
export async function supportRecipient(): Promise<string | null> {
  const { data } = await db
    .from("staff")
    .select("email")
    .eq("role", "customer_support")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return data?.email ?? (config.supportEmail || null);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendEscalationEmail(fields: {
  customerName: string;
  customerEmail: string;
  conversationId: string | null;
  ticketId: string;
  escalationId: string;
  category: string;
  reason: string;
  preferredTime: string | null;
}): Promise<boolean> {
  const to = await supportRecipient();
  if (!resend || !to) {
    console.error("[email] Resend or support recipient not configured; escalation email skipped");
    return false;
  }
  const rows: [string, string][] = [
    ["Customer name", fields.customerName],
    ["Customer email", fields.customerEmail],
    ["Conversation ID", fields.conversationId ?? "n/a"],
    ["Ticket ID", fields.ticketId],
    ["Escalation ID", fields.escalationId],
    ["Category", fields.category],
    ["Reason", fields.reason],
    ["Preferred callback time", fields.preferredTime ?? "Not given"],
  ];
  const html = `<h2 style="font-family:Inter,Arial,sans-serif;color:#12305f">New escalation from Jane</h2>
<table style="font-family:Inter,Arial,sans-serif;font-size:14px;border-collapse:collapse">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#5b6472">${k}</td><td style="padding:6px 0;color:#111827">${escapeHtml(v)}</td></tr>`,
  )
  .join("\n")}
</table>`;
  const { error } = await resend.emails.send({
    from: config.emailFrom,
    to,
    subject: `[Escalation · ${fields.category}] ${fields.customerName}`,
    html,
  });
  if (error) {
    console.error("[email] escalation email failed:", error);
    return false;
  }
  return true;
}
