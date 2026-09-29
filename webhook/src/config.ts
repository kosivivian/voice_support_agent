function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? process.env.WEBHOOK_PORT ?? 8787),
  isProduction: process.env.NODE_ENV === "production",

  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  agentModel: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",
  agentEffort: (process.env.AGENT_EFFORT ?? "low") as "low" | "medium" | "high",
  summaryModel: process.env.SUMMARY_MODEL ?? "claude-haiku-4-5",

  mcpServerUrl: required("MCP_SERVER_URL").replace(/\/+$/, ""),
  mcpApiKey: required("MCP_API_KEY"),

  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  // Shared secret Vapi sends on custom-LLM and server-URL requests (optional in dev).
  vapiWebhookSecret: process.env.VAPI_WEBHOOK_SECRET ?? "",

  adminJwtSecret: required("ADMIN_JWT_SECRET"),
  adminSessionHours: 8,

  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "RelayPay Support <onboarding@resend.dev>",
  supportEmail: required("SUPPORT_EMAIL"),

  // Comma-separated origins allowed to call the public /api routes (the Next.js site).
  webOrigins: (process.env.WEB_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  maxTurns: 10,
  maxCallSeconds: 8 * 60,
  // Start wrapping up with enough time left for Jane to create the ticket and escalation.
  wrapUpAfterSeconds: Number(process.env.WRAP_UP_AFTER_SECONDS ?? 7 * 60),
};

export const GREETING = "Hi, this is Jane, an AI assistant for RelayPay. How may I help you?";
export const CLOSING_LINE = "Thank you for contacting RelayPay. Goodbye.";
export const FALLBACK_LINE =
  "I'm sorry, I'm experiencing a technical issue right now. Our support team has been notified and will follow up with you. " +
  CLOSING_LINE;
