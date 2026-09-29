import { createHash } from "node:crypto";

// Fixed namespace so the same Vapi call id always maps to the same conversation id.
const NAMESPACE = "6f1c4a52-9d3e-4b8a-a1f7-2c5e8d9b0a31";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/** RFC 4122 v5 UUID. */
export function uuidV5(name: string, namespace = NAMESPACE): string {
  const hash = createHash("sha1").update(uuidToBytes(namespace)).update(name).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Conversation id for a Vapi call. Derived (not stored) so the webhook server
 * stays stateless: every turn of the same call resolves to the same id.
 */
export const conversationIdForCall = (vapiCallId: string) => uuidV5(`vapi-call:${vapiCallId}`);

export const isSafeId = (value: string) => /^[A-Za-z0-9_-]{8,128}$/.test(value);
