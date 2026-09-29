import cors from "cors";
import express from "express";
import { adminRouter } from "./adminApi.js";
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
  res.json({ ok: true, service: "relaypay-webhook", model: config.agentModel });
});

app.use("/vapi", vapiRouter);
app.use("/api", cors({ origin: config.webOrigins }), publicRouter);
// Called server-to-server by the Next.js admin proxy, so no CORS.
app.use("/admin/api", adminRouter);

app.listen(config.port, () => {
  console.log(`RelayPay webhook server listening on :${config.port}`);
  console.log(`  Vapi custom LLM URL:  <public-url>/vapi   (Vapi calls /vapi/chat/completions)`);
  console.log(`  Vapi server URL:      <public-url>/vapi/events`);
});
