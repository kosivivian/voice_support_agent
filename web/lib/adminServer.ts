export const ADMIN_COOKIE = "relaypay_admin";
export const SESSION_SECONDS = 8 * 60 * 60;

/** Webhook server base URL, used server-side only by the admin proxy. */
export function webhookUrl(): string {
  const url = process.env.WEBHOOK_URL ?? process.env.NEXT_PUBLIC_WEBHOOK_URL;
  if (!url) throw new Error("WEBHOOK_URL is not set");
  return url.replace(/\/+$/, "");
}
