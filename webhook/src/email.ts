import { Resend } from "resend";
import { config } from "./config.js";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sends a notification to the customer-support inbox. Never throws. */
export async function notifySupport(subject: string, fields: [string, string][], note?: string): Promise<boolean> {
  if (!resend) {
    console.error(`[email] RESEND_API_KEY not set; skipped "${subject}"`);
    return false;
  }
  const html = `<h2 style="font-family:Inter,Arial,sans-serif;color:#12305f">${escapeHtml(subject)}</h2>
${note ? `<p style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#111827">${escapeHtml(note)}</p>` : ""}
<table style="font-family:Inter,Arial,sans-serif;font-size:14px;border-collapse:collapse">
${fields
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#5b6472;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;color:#111827;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
  )
  .join("\n")}
</table>`;
  try {
    const { error } = await resend.emails.send({ from: config.emailFrom, to: config.supportEmail, subject, html });
    if (error) {
      console.error("[email] send failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send threw:", err);
    return false;
  }
}
