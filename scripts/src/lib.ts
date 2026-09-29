import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ASSETS = path.join(ROOT, "aat-c3-week-6-support-agent-main", "assets");

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name} (set it in the root .env)`);
    process.exit(1);
  }
  return value;
}

export function serviceClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("VOYAGE_API_KEY")}`,
    },
    body: JSON.stringify({
      input: texts,
      model: process.env.VOYAGE_MODEL ?? "voyage-3.5-lite",
      input_type: inputType,
      output_dimension: 1024,
    }),
  });
  if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
