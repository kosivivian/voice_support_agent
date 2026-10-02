import "./keepalive.js";
import cors from "cors";
import express from "express";
import { adminRouter } from "./adminApi.js";
import { startAgentPool } from "./agentPool.js";
import { getMcpTools, keepMcpConnectionWarm } from "./mcpClient.js";
import { config } from "./config.js";
import { publicRouter } from "./publicApi.js";
import { vapiRouter } from "./vapi.js";

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

if (config.isProduction) {
  app.use((req, res, next) => {
    if (req.path !== "/health" && req.protocol !== "https") {
      res.status(403).json({ error: "HTTPS required" });
      return;
    }
    next();
  });
}

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "relaypay-webhook", model: config.agentModel, commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local", streaming: true });
});

app.use("/vapi", vapiRouter);
app.use("/api", cors({ origin: config.webOrigins }), publicRouter);
// Called server-to-server by the Next.js admin proxy, so no CORS.
app.use("/admin/api", adminRouter);

// Warm everything a call turn needs before the first call arrives.
keepMcpConnectionWarm();
getMcpTools()
  .then(() => startAgentPool())
  .catch((err) => {
    console.error("[boot] MCP tools unavailable; agent processes will start on demand:", err instanceof Error ? err.message : err);
    startAgentPool();
  });

app.listen(config.port, "::", () => {
  console.log(`RelayPay webhook server listening on :${config.port}`);
  console.log(`  Vapi custom LLM URL:  <public-url>/vapi   (Vapi calls /vapi/chat/completions)`);
  console.log(`  Vapi server URL:      <public-url>/vapi/events`);
});
