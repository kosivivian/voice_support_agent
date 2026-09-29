"use client";

import Link from "next/link";
import { LoadState, PageHeader, StatusBadge } from "@/components/admin";
import { fmtDateTime, shortId } from "@/lib/format";
import type { Escalation } from "@/lib/types";
import { useAdminData } from "@/lib/useAdmin";
import styles from "../../admin.module.css";

export default function EscalationsPage() {
  const { data, error, loading, reload } = useAdminData<Escalation[]>("escalations?limit=500");
  return (
    <>
      <PageHeader title="Escalations" description="Urgent or sensitive cases routed to customer support. Every escalation links to a ticket." onRefresh={reload} />
      <div className="card">
        <LoadState loading={loading && !data} error={error} empty={data?.length === 0} />
        {data?.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Escalation</th>
                  <th>Ticket</th>
                  <th>Category</th>
                  <th>Customer</th>
                  <th>Reason</th>
                  <th>Callback</th>
                  <th>Status</th>
                  <th>Emailed</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.escalation_id}>
                    <td className="mono-id" title={e.escalation_id}>
                      {e.conversation_id ? <Link href={`/admin/conversations/${e.conversation_id}`}>{shortId(e.escalation_id)}</Link> : shortId(e.escalation_id)}
                    </td>
                    <td className="mono-id" title={e.ticket_id}>
                      {shortId(e.ticket_id)}
                    </td>
                    <td>
                      <span className="badge">{e.category}</span>
                    </td>
                    <td>
                      <div>{e.user_name}</div>
                      <div className="muted small">{e.user_email}</div>
                    </td>
                    <td>
                      <span className={styles.clamp} title={e.reason}>
                        {e.reason}
                      </span>
                    </td>
                    <td>{e.preferred_time ?? <span className="muted">—</span>}</td>
                    <td>
                      <StatusBadge value={e.status} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{e.notified_at ? fmtDateTime(e.notified_at) : <span className="muted">Not sent</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.created_at)}</td>
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
