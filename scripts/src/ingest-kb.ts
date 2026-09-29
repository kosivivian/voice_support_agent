// Chunks the approved knowledge base by heading, embeds each chunk with Voyage
// and replaces the contents of the knowledge_base table. Re-run whenever the
// source document changes — retrieve_knowledge always reads the current table,
// so no server restart is needed.
import fs from "node:fs";
import path from "node:path";
import { ASSETS, embed, serviceClient } from "./lib.js";

const KB_PATH = process.argv[2] ?? path.join(ASSETS, "relaypay-knowledge-base.md");

interface Chunk {
  source_title: string;
  content: string;
}

function chunkMarkdown(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let h2 = "";
  let h3 = "";
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    buffer = [];
    if (!body || !h2) return;
    const title = h3 ? `${h2} > ${h3}` : h2;
    chunks.push({ source_title: title, content: body });
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("# ")) continue; // document title + preamble are not support content
    if (line.startsWith("## ")) {
      flush();
      h2 = line.slice(3).trim();
      h3 = "";
    } else if (line.startsWith("### ")) {
      flush();
      h3 = line.slice(4).trim();
    } else if (h2) {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}

async function main() {
  const markdown = fs.readFileSync(KB_PATH, "utf8");
  const chunks = chunkMarkdown(markdown);
  console.log(`Chunked ${path.basename(KB_PATH)} into ${chunks.length} sections`);

  // Embed the title with the body so short sections still carry their topic.
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += 64) {
    const batch = chunks.slice(i, i + 64);
    embeddings.push(...(await embed(batch.map((c) => `${c.source_title}\n\n${c.content}`), "document")));
  }

  const supabase = serviceClient();
  const { error: delErr } = await supabase
    .from("knowledge_base")
    .delete()
    .neq("chunk_id", "00000000-0000-0000-0000-000000000000");
  if (delErr) throw delErr;

  const rows = chunks.map((c, i) => ({ ...c, embedding: JSON.stringify(embeddings[i]) }));
  const { error } = await supabase.from("knowledge_base").insert(rows);
  if (error) throw error;

  for (const c of chunks) console.log(`  - ${c.source_title}`);
  console.log(`Inserted ${rows.length} chunks into knowledge_base`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
