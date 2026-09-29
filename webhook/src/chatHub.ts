import type { Response } from "express";

// One-way text channel from Jane to the caller's chat widget, keyed by Vapi
// call id. Messages are buffered briefly so a widget that subscribes a moment
// late still receives them.

export interface ChatPush {
  id: string;
  title: string;
  body: string;
  sentAt: string;
}

interface Channel {
  clients: Set<Response>;
  history: ChatPush[];
  touchedAt: number;
}

const channels = new Map<string, Channel>();
const HISTORY_LIMIT = 20;
const CHANNEL_TTL_MS = 60 * 60 * 1000;

function channel(callId: string): Channel {
  let ch = channels.get(callId);
  if (!ch) {
    ch = { clients: new Set(), history: [], touchedAt: Date.now() };
    channels.set(callId, ch);
  }
  ch.touchedAt = Date.now();
  return ch;
}

function write(res: Response, push: ChatPush) {
  res.write(`event: jane-message\ndata: ${JSON.stringify(push)}\n\n`);
}

export function subscribe(callId: string, res: Response) {
  const ch = channel(callId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  for (const push of ch.history) write(res, push);
  ch.clients.add(res);

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);
  res.on("close", () => {
    clearInterval(keepAlive);
    ch.clients.delete(res);
  });
}

/** Returns the number of widgets that received the message live. */
export function publish(callId: string, title: string, body: string): { push: ChatPush; delivered: number } {
  const ch = channel(callId);
  const push: ChatPush = { id: crypto.randomUUID(), title, body, sentAt: new Date().toISOString() };
  ch.history.push(push);
  if (ch.history.length > HISTORY_LIMIT) ch.history.shift();
  for (const res of ch.clients) write(res, push);
  return { push, delivered: ch.clients.size };
}

setInterval(() => {
  const cutoff = Date.now() - CHANNEL_TTL_MS;
  for (const [id, ch] of channels) {
    if (ch.clients.size === 0 && ch.touchedAt < cutoff) channels.delete(id);
  }
}, 10 * 60 * 1000).unref();
