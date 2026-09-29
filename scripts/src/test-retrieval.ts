// Prints similarity scores for sample queries so KB_SIMILARITY_THRESHOLD can be
// calibrated. Usage: npm run kb:test -- "your question"
import { embed, serviceClient } from "./lib.js";

const DEFAULT_QUERIES = [
  "What fees does RelayPay charge for international payments?",
  "How long do international payouts take?",
  "Can RelayPay guarantee my payout arrives by 9am tomorrow?",
  "Why is my account under review?",
  "Do you support bitcoin payments?",
  "What is the weather in Lagos today?",
  "Can you recommend a good restaurant?",
];

async function main() {
  const queries = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_QUERIES;
  const threshold = Number(process.env.KB_SIMILARITY_THRESHOLD ?? 0.5);
  const supabase = serviceClient();
  const vectors = await embed(queries, "query");

  for (let i = 0; i < queries.length; i++) {
    const { data, error } = await supabase.rpc("match_knowledge", {
      query_embedding: JSON.stringify(vectors[i]),
      match_count: 3,
    });
    if (error) throw error;
    console.log(`\n${queries[i]}`);
    for (const row of data as { source_title: string; similarity: number }[]) {
      const mark = row.similarity >= threshold ? "PASS" : "    ";
      console.log(`  ${mark} ${row.similarity.toFixed(3)}  ${row.source_title}`);
    }
  }
  console.log(`\nThreshold: ${threshold}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
