"use client";

import Link from "next/link";
import { LoadState, PageHeader } from "@/components/admin";
import { fmtDateTime, shortId } from "@/lib/format";
import { useAdminData } from "@/lib/useAdmin";
import styles from "../../admin.module.css";

interface Errors {
  conversations: { conversation_id: string; start_time: string; error_message: string | null; customer_email: string | null }[];
  turns: { turn_id: string; conversation_id: string; turn_number: number; content: string; error_message: string | null; created_at: string }[];
  tool_calls: { tool_call_id: string; conversation_id: string | null; turn_number: number | null; tool_name: string; input: unknown; error_message: string | null; created_at: string }[];
}

const ConvLink = ({ id }: { id: string | null }) =>
  id ? (
    <Link className="mono-id" href={`/admin/conversations/${id}`}>
      {shortId(id)}
    </Link>
  ) : (
    <span className="muted">—</span>
  );

export default function ErrorsPage() {
  const { data, error, loading, reload } = useAdminData<Errors>("errors");
  return (
    <>
      <PageHeader title="Error logs" description="Conversations, turns and tool calls that ended with an error." onRefresh={reload} />
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Conversations with errors</h2>
            <div className={`card ${styles.tableWrap}`}>
              {data.conversations.length === 0 ? (
                <div className={styles.empty}>None.</div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Conversation</th>
                      <th>Customer</th>
                      <th>Error</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.conversations.map((c) => (
                      <tr key={c.conversation_id}>
                        <td>
                          <ConvLink id={c.conversation_id} />
                        </td>
                        <td>{c.customer_email ?? "—"}</td>
                        <td className="error-text">{c.error_message ?? "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(c.start_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Turns with errors</h2>
            <div className={`card ${styles.tableWrap}`}>
              {data.turns.length === 0 ? (
                <div className={styles.empty}>None.</div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Conversation</th>
                      <th className={styles.num}>Turn</th>
                      <th>Error</th>
                      <th>Jane said</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.turns.map((t) => (
                      <tr key={t.turn_id}>
                        <td>
                          <ConvLink id={t.conversation_id} />
                        </td>
                        <td className={styles.num}>{t.turn_number}</td>
                        <td className="error-text">{t.error_message ?? "—"}</td>
                        <td>
                          <span className={styles.clamp}>{t.content}</span>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Failed tool calls</h2>
            <div className={`card ${styles.tableWrap}`}>
              {data.tool_calls.length === 0 ? (
                <div className={styles.empty}>None.</div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Conversation</th>
                      <th className={styles.num}>Turn</th>
                      <th>Tool</th>
                      <th>Error</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tool_calls.map((t) => (
                      <tr key={t.tool_call_id}>
                        <td>
                          <ConvLink id={t.conversation_id} />
                        </td>
                        <td className={styles.num}>{t.turn_number ?? "—"}</td>
                        <td>{t.tool_name}</td>
                        <td className="error-text">{t.error_message ?? "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
