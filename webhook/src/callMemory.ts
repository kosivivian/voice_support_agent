// Per-call lookup results, kept in memory so later turns can answer follow-ups
// without repeating lookups. Lost on restart; the agent then looks things up again.
const TTL_MS = 30 * 60 * 1000;

interface CallRecords {
  touchedAt: number;
  entries: Map<string, { tool: string; input: unknown; output: string }>;
}

const calls = new Map<string, CallRecords>();

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, rec] of calls) if (rec.touchedAt < cutoff) calls.delete(id);
}

export function rememberLookup(callId: string, tool: string, input: unknown, output: string) {
  sweep();
  const rec = calls.get(callId) ?? { touchedAt: Date.now(), entries: new Map() };
  rec.touchedAt = Date.now();
  rec.entries.set(`${tool}:${JSON.stringify(input)}`, { tool, input, output });
  calls.set(callId, rec);
}

export function earlierLookups(callId: string): string | null {
  const rec = calls.get(callId);
  if (!rec || rec.entries.size === 0) return null;
  rec.touchedAt = Date.now();
  return [...rec.entries.values()].map((e) => `${e.tool}(${JSON.stringify(e.input)}) -> ${e.output}`).join("\n");
}
