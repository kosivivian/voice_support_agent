"use client";

import Link from "next/link";
import { use } from "react";
import { LoadState, PageHeader, StatusBadge } from "@/components/admin";
import { fmtDateTime, fmtDuration, fmtUsd } from "@/lib/format";
import type { Conversation, ConversationEvent, Escalation, RetrievalLog, Ticket, ToolCall, Turn } from "@/lib/types";
import { useAdminData } from "@/lib/useAdmin";
import styles from "../../../admin.module.css";

interface Detail {
  conversation: Conversation;
  turns: Turn[];
  tool_calls: ToolCall[];
  retrieval_logs: RetrievalLog[];
  events: ConversationEvent[];
  tickets: Ticket[];
  escalations: Escalation[];
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export default function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useAdminData<Detail>(`conversations/${id}`);

  if (!data) {
    return (
      <>
        <PageHeader title="Conversation" />
        <div className="card">
          <LoadState loading={loading} error={error} />
        </div>
      </>
    );
  }

  const { conversation: c } = data;
  const toolsByTurn = (n: number) => data.tool_calls.filter((t) => t.turn_number === n);
  const retrievalsByTurn = (n: number) => data.retrieval_logs.filter((r) => r.turn_number === n);

  return (
    <>
      <PageHeader title="Conversation transcript" description={c.conversation_id} onRefresh={reload} />
      <p className="small" style={{ marginTop: -8, marginBottom: 16 }}>
        <Link href="/admin/conversations">← All conversations</Link>
      </p>

      <div className={styles.detailGrid}>
        <section className="card" aria-label="Transcript">
          {data.turns.length === 0 ? <div className={styles.empty}>No turns logged.</div> : null}
          {data.turns.map((t) => {
            const tools = t.role === "assistant" ? toolsByTurn(t.turn_number) : [];
            const retrievals = t.role === "assistant" ? retrievalsByTurn(t.turn_number) : [];
            return (
              <div key={t.turn_id} className={styles.turn}>
                <div className={styles.turnHead}>
                  <span className={styles.speaker}>{t.role === "user" ? "Customer" : "Jane"}</span>
                  <span>Turn {t.turn_number}</span>
                  {t.answer_type ? <span className="badge">{t.answer_type}</span> : null}
                  {t.status === "error" ? <StatusBadge value="error" /> : null}
                  <span style={{ marginLeft: "auto" }}>{fmtDateTime(t.created_at)}</span>
                </div>
                <div className={styles.turnText}>{t.content}</div>
                {t.error_message ? <p className="error-text">{t.error_message}</p> : null}
                {t.role === "assistant" && t.model_used ? (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    {t.model_used} · {t.token_count_input ?? 0} in / {t.token_count_output ?? 0} out
                    {t.cost_usd != null ? ` · ${fmtUsd(Number(t.cost_usd))}` : ""}
                    {t.latency_ms != null ? ` · ${(t.latency_ms / 1000).toFixed(1)}s` : ""}
                  </div>
                ) : null}

                {tools.length || retrievals.length ? (
                  <div className={styles.trace}>
                    {tools.map((tc) => (
                      <details key={tc.tool_call_id} className={styles.traceItem}>
                        <summary>
                          <strong>{tc.tool_name}</strong> <StatusBadge value={tc.status} />
                          {tc.duration_ms != null ? <span className="muted"> · {tc.duration_ms} ms</span> : null}
                        </summary>
                        <div className="muted small" style={{ marginTop: 6 }}>
                          Input
                        </div>
                        <pre className={styles.pre}>{pretty(tc.input)}</pre>
                        <div className="muted small" style={{ marginTop: 6 }}>
                          Output
                        </div>
                        <pre className={styles.pre}>{pretty(tc.output)}</pre>
                        {tc.error_message ? <p className="error-text">{tc.error_message}</p> : null}
                      </details>
                    ))}
                    {retrievals.map((r) => (
                      <details key={r.retrieval_id} className={styles.traceItem}>
                        <summary>
                          <strong>Retrieved:</strong> “{r.query}”{" "}
                          <span className={`badge ${r.above_threshold ? "badge-pass" : "badge-fail"}`}>
                            {r.above_threshold ? "Grounded" : "Below threshold"}
                          </span>
                        </summary>
                        {r.chunks_returned.map((ch) => (
                          <div key={ch.chunk_id} style={{ marginTop: 8 }}>
                            <div className="small">
                              <strong>{ch.source_title}</strong> <span className="muted">· similarity {ch.similarity.toFixed(3)}</span>
                            </div>
                            <pre className={styles.pre}>{ch.content}</pre>
                          </div>
                        ))}
                      </details>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <dl className={styles.kv}>
              <dt>Status</dt>
              <dd>
                <StatusBadge value={c.status} />
              </dd>
              <dt>Customer</dt>
              <dd>{c.customer_email ?? "Not verified"}</dd>
              <dt>Started</dt>
              <dd>{fmtDateTime(c.start_time)}</dd>
              <dt>Duration</dt>
              <dd>{fmtDuration(c.start_time, c.end_time)}</dd>
              <dt>Turns</dt>
              <dd>{c.turn_count}</dd>
              <dt>Ended</dt>
              <dd>{c.ended_reason ?? "—"}</dd>
              <dt>Vapi call</dt>
              <dd className="mono-id">{c.vapi_call_id ?? "—"}</dd>
              {c.error_message ? (
                <>
                  <dt>Error</dt>
                  <dd className="error-text">{c.error_message}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="card" style={{ padding: "14px 16px" }}>
            <h2 className={styles.sectionTitle}>Summary</h2>
            <p style={{ margin: 0 }} className="small">
              {c.summary ?? "Generated when the call ends."}
            </p>
          </div>

          <div className="card" style={{ padding: "14px 16px" }}>
            <h2 className={styles.sectionTitle}>Tickets &amp; escalations</h2>
            {data.tickets.length === 0 ? <p className="muted small">None created.</p> : null}
            {data.tickets.map((t) => {
              const esc = data.escalations.filter((e) => e.ticket_id === t.ticket_id);
              return (
                <div key={t.ticket_id} className="small" style={{ marginBottom: 12 }}>
                  <div>
                    <strong>Ticket</strong> <span className="mono-id">{t.ticket_id}</span>
                  </div>
                  <div>{t.subject}</div>
                  {esc.map((e) => (
                    <div key={e.escalation_id} style={{ marginTop: 6, paddingLeft: 10, borderLeft: "2px solid var(--border-strong)" }}>
                      <div>
                        <strong>Escalation</strong> <span className="badge">{e.category}</span>
                      </div>
                      <div className="muted">{e.reason}</div>
                      {e.preferred_time ? <div>Callback: {e.preferred_time}</div> : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="card" style={{ padding: "14px 16px" }}>
            <h2 className={styles.sectionTitle}>Agent events</h2>
            {data.events.length === 0 ? <p className="muted small">None logged.</p> : null}
            {data.events.map((e) => (
              <div key={e.event_id} className="small" style={{ marginBottom: 8 }}>
                <span className="badge">{e.event_type}</span> <span className="muted">turn {e.turn_number ?? "—"}</span>
                <div>{e.summary}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
