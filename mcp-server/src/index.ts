import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { buildServer, type CallContext } from "./tools.js";

function header(req: Request | undefined, name: string): string | null {
  return req?.headers.get(name) ?? null;
}

const handler = createMcpHandler(
  ({ requestInfo }) => {
    const turnNumber = Number(header(requestInfo, "x-turn-number"));
    const ctx: CallContext = {
      conversationId: header(requestInfo, "x-conversation-id"),
      turnId: header(requestInfo, "x-turn-id"),
      turnNumber: Number.isFinite(turnNumber) && turnNumber > 0 ? turnNumber : null,
    };
    return buildServer(ctx);
  },
  { onerror: (err) => console.error("[mcp]", err.message) },
);
const mcpNodeHandler = toNodeHandler(handler);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "relaypay-mcp" });
});

app.use("/mcp", (req, res, next) => {
  if (config.enforceHttps && req.protocol !== "https") {
    res.status(403).json({ error: "HTTPS required" });
    return;
  }
  const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const key = req.header("x-api-key") ?? bearer ?? "";
  if (!safeEqual(key, config.mcpApiKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.all("/mcp", express.json({ limit: "1mb" }), (req, res) => {
  void mcpNodeHandler(req, res, req.body);
});

app.listen(config.port, () => {
  console.log(`RelayPay MCP server listening on :${config.port} (POST /mcp)`);
});
