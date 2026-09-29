"use client";

import Link from "next/link";
import { LoadState, PageHeader, StatusBadge } from "@/components/admin";
import { fmtDateTime, shortId } from "@/lib/format";
import type { Ticket } from "@/lib/types";
import { useAdminData } from "@/lib/useAdmin";
import styles from "../../admin.module.css";

export default function TicketsPage() {
  const { data, error, loading, reload } = useAdminData<Ticket[]>("tickets?limit=500");
  return (
    <>
      <PageHeader title="Tickets" description="Support tickets from calls with Jane and from the chat fallback form." onRefresh={reload} />
      <div className="card">
        <LoadState loading={loading && !data} error={error} empty={data?.length === 0} />
        {data?.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Conversation</th>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Subject</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.ticket_id}>
                    <td className="mono-id" title={t.ticket_id}>
                      {shortId(t.ticket_id)}
                    </td>
                    <td className="mono-id">
                      {t.conversation_id ? <Link href={`/admin/conversations/${t.conversation_id}`}>{shortId(t.conversation_id)}</Link> : "—"}
                    </td>
                    <td>{t.user_name}</td>
                    <td>{t.user_email}</td>
                    <td>
                      <div>{t.subject}</div>
                      <div className={`muted small ${styles.clamp}`} title={t.description}>
                        {t.description}
                      </div>
                    </td>
                    <td>{t.source === "chat_fallback" ? "Chat form" : "Voice"}</td>
                    <td>
                      <StatusBadge value={t.status} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(t.created_at)}</td>
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
