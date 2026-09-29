import { Router } from "express";
import * as z from "zod";
import { subscribe } from "./chatHub.js";
import { notifySupport } from "./email.js";
import { isSafeId } from "./ids.js";
import { anonDb } from "./supabase.js";

export const publicRouter = Router();

// One-way chat channel for the active call (Server-Sent Events).
publicRouter.get("/chat-stream/:callId", (req, res) => {
  const { callId } = req.params;
  if (!isSafeId(callId)) {
    res.status(400).json({ error: "Invalid call id" });
    return;
  }
  subscribe(callId, res);
});

const fallbackSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  message: z.string().trim().min(1).max(4000),
  reason: z.string().max(200).optional(),
});

// Tiny per-IP limiter so the public form can't be used to spam the support inbox.
const recent = new Map<string, number[]>();
function allow(ip: string, limit = 5, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  recent.set(ip, hits);
  return true;
}

// Chat-widget fallback when voice can't start. Jane is not involved.
publicRouter.post("/fallback-ticket", async (req, res) => {
  const parsed = fallbackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide your name, a valid email and a message." });
    return;
  }
  if (!allow(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many messages. Please try again later." });
    return;
  }
  const { name, email, message, reason } = parsed.data;
  const ticketId = crypto.randomUUID();
  const { error } = await anonDb.from("tickets").insert({
    ticket_id: ticketId,
    conversation_id: null,
    source: "chat_fallback",
    user_name: name,
    user_email: email.toLowerCase(),
    subject: "Message left via chat widget (voice unavailable)",
    description: message,
    category: "general",
    priority: "normal",
  });
  if (error) {
    console.error("[fallback] ticket insert failed:", error.message);
    res.status(500).json({ error: "We couldn't save your message. Please try again shortly." });
    return;
  }
  void notifySupport("New message from the RelayPay support page", [
    ["Ticket ID", ticketId],
    ["Name", name],
    ["Email", email],
    ["Why voice was unavailable", reason ?? "Not reported"],
    ["Message", message],
  ]);
  res.status(201).json({ ticket_id: ticketId });
});
