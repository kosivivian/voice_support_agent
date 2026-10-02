"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadState, PageHeader } from "@/components/admin";
import { fmtDateTime, shortId } from "@/lib/format";
import type { Ticket } from "@/lib/types";
import { adminRequest, useAdminData } from "@/lib/useAdmin";
import styles from "../../admin.module.css";

type WorkflowStatus = "open" | "processing" | "resolved";

const LABEL: Record<WorkflowStatus, string> = { open: "Open", processing: "Processing", resolved: "Resolved" };
// Older tickets may still say "closed"; they count as resolved.
const workflowStatus = (s: Ticket["status"]): WorkflowStatus => (s === "closed" ? "resolved" : s);
const NEXT_ACTION: Record<WorkflowStatus, { to: WorkflowStatus; label: string }> = {
  open: { to: "processing", label: "Start processing" },
  processing: { to: "resolved", label: "Mark resolved" },
  resolved: { to: "open", label: "Reopen" },
};

export default function TicketsPage() {
  const { data, error, loading, reload } = useAdminData<Ticket[]>("tickets?limit=500");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const setStatus = async (ticketId: string, status: WorkflowStatus) => {
    setBusy(ticketId);
    setActionError(null);
    try {
      await adminRequest(`tickets/${ticketId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update the ticket");
    } finally {
      setBusy(null);
    }
  };

  const urgentOpen = data?.filter((t) => t.urgent && workflowStatus(t.status) !== "resolved").length ?? 0;

  return (
    <>
      <PageHeader
        title="Tickets"
        description={
          data
            ? `${urgentOpen} urgent ticket${urgentOpen === 1 ? "" : "s"} still open. Escalated tickets are listed first.`
            : "Support tickets from calls with Jane and from the chat fallback form."
        }
        onRefresh={reload}
      />
      {actionError ? <p className="error-text">{actionError}</p> : null}
      <div className="card">
        <LoadState loading={loading && !data} error={error} empty={data?.length === 0} />
        {data?.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Ticket</th>
                  <th>Customer</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => {
                  const status = workflowStatus(t.status);
                  const action = NEXT_ACTION[status];
                  const escalation = t.escalations?.[0];
                  return (
                    <tr key={t.ticket_id}>
                      <td>
                        {t.urgent ? <span className="badge badge-urgent">Urgent</span> : <span className="badge">Normal</span>}
                        {escalation ? (
                          <div className="muted small" style={{ marginTop: 4 }}>
                            {escalation.category.replace(/_/g, " ")}
                          </div>
                        ) : null}
                      </td>
                      <td className="mono-id" title={t.ticket_id}>
                        <div>{shortId(t.ticket_id)}</div>
                        {t.conversation_id ? (
                          <Link className="small" href={`/admin/conversations/${t.conversation_id}`}>
                            View call
                          </Link>
                        ) : (
                          <span className="muted small">{t.source === "chat_fallback" ? "Chat form" : "—"}</span>
                        )}
                      </td>
                      <td>
                        <div>{t.user_name}</div>
                        <div className="muted small">{t.user_email}</div>
                      </td>
                      <td>
                        <div>{t.subject}</div>
                        <div className={`muted small ${styles.clamp}`} title={t.description}>
                          {t.description}
                        </div>
                        {escalation?.preferred_time ? <div className="small">Callback: {escalation.preferred_time}</div> : null}
                      </td>
                      <td>
                        <span className={`badge badge-${status}`}>{LABEL[status]}</span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(t.created_at)}</td>
                      <td>
                        <button
                          className={`btn btn-sm ${action.to === "resolved" ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => setStatus(t.ticket_id, action.to)}
                          disabled={busy === t.ticket_id}
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {busy === t.ticket_id ? "Saving…" : action.label}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  );
}
