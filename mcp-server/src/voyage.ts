import { config } from "./config.js";

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.voyageApiKey}` },
    body: JSON.stringify({
      input: [text],
      model: config.voyageModel,
      input_type: "query",
      output_dimension: 1024,
    }),
  });
  if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status}`);
  const body = (await res.json()) as { data: { embedding: number[] }[] };
  return body.data[0].embedding;
}
