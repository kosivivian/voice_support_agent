function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? process.env.MCP_PORT ?? 8788),
  mcpApiKey: required("MCP_API_KEY"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  voyageApiKey: required("VOYAGE_API_KEY"),
  voyageModel: process.env.VOYAGE_MODEL ?? "voyage-3.5-lite",
  similarityThreshold: Number(process.env.KB_SIMILARITY_THRESHOLD ?? 0.5),
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "RelayPay Support <onboarding@resend.dev>",
  supportEmail: process.env.SUPPORT_EMAIL ?? "",
  // Secret for hashing verification codes. Falls back to MCP_API_KEY so a missing value never stores codes unhashed.
  otpSecret: process.env.OTP_SECRET || required("MCP_API_KEY"),
  // Codes for test addresses ending in .example (which can't receive mail) go here instead.
  demoOtpInbox: (process.env.DEMO_OTP_INBOX ?? "").trim(),
  // Reject plain-HTTP requests when running behind a TLS-terminating proxy (Railway).
  enforceHttps: process.env.NODE_ENV === "production",
};
