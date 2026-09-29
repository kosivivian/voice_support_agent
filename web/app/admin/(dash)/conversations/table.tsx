"use client";

import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/admin";
import { fmtDateTime, fmtDuration, shortId } from "@/lib/format";
import type { Conversation } from "@/lib/types";
import styles from "../../admin.module.css";

export function ConversationTable({ rows }: { rows: Conversation[] }) {
  const router = useRouter();
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Conversation</th>
            <th>Customer email</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Status</th>
            <th className={styles.num}>Turns</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.conversation_id}
              className={styles.clickRow}
              tabIndex={0}
              onClick={() => router.push(`/admin/conversations/${c.conversation_id}`)}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/admin/conversations/${c.conversation_id}`)}
            >
              <td className="mono-id" title={c.conversation_id}>
                {shortId(c.conversation_id)}
              </td>
              <td>{c.customer_email ?? <span className="muted">Not verified</span>}</td>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(c.start_time)}</td>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDuration(c.start_time, c.end_time)}</td>
              <td>
                <StatusBadge value={c.status} />
              </td>
              <td className={styles.num}>{c.turn_count}</td>
              <td>
                <span className={styles.clamp}>{c.summary ?? <span className="muted">{c.status === "active" ? "In progress" : "—"}</span>}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
