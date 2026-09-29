"use client";

import Link from "next/link";
import { LoadState, PageHeader } from "@/components/admin";
import { fmtDateTime, shortId } from "@/lib/format";
import type { RetrievalLog } from "@/lib/types";
import { useAdminData } from "@/lib/useAdmin";
import styles from "../../admin.module.css";

export default function RetrievalPage() {
  const { data, error, loading, reload } = useAdminData<RetrievalLog[]>("retrieval-logs?limit=500");
  return (
    <>
      <PageHeader title="Retrieval logs" description="Every knowledge base search Jane made, with the chunks and similarity scores returned." onRefresh={reload} />
      <div className="card">
        <LoadState loading={loading && !data} error={error} empty={data?.length === 0} />
        {data?.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Conversation</th>
                  <th className={styles.num}>Turn</th>
                  <th>Query</th>
                  <th>Sources · similarity</th>
                  <th>Grounded</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.retrieval_id}>
                    <td className="mono-id">
                      {r.conversation_id ? <Link href={`/admin/conversations/${r.conversation_id}`}>{shortId(r.conversation_id)}</Link> : "—"}
                    </td>
                    <td className={styles.num}>{r.turn_number ?? "—"}</td>
                    <td style={{ maxWidth: 280 }}>{r.query}</td>
                    <td>
                      <details>
                        <summary className="small">
                          {r.source_titles.map((t, i) => (
                            <span key={i} style={{ display: "block" }}>
                              {t} <span className="muted">· {r.similarity_scores[i]?.toFixed(3)}</span>
                            </span>
                          ))}
                        </summary>
                        {r.chunks_returned.map((c) => (
                          <pre key={c.chunk_id} className={styles.pre}>
                            {c.source_title}
                            {"\n\n"}
                            {c.content}
                          </pre>
                        ))}
                      </details>
                    </td>
                    <td>
                      <span className={`badge ${r.above_threshold ? "badge-pass" : "badge-fail"}`}>{r.above_threshold ? "Yes" : "Below threshold"}</span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  );
}
