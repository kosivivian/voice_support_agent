"use client";

import { LoadState, PageHeader, Tile } from "@/components/admin";
import { fmtInt, fmtPct, fmtSeconds } from "@/lib/format";
import type { Conversation, Metrics } from "@/lib/types";
import { useAdminData } from "@/lib/useAdmin";
import styles from "../admin.module.css";
import { ConversationTable } from "./conversations/table";

export default function OverviewPage() {
  const metrics = useAdminData<Metrics>("metrics");
  const recent = useAdminData<Conversation[]>("conversations?limit=8");
  const m = metrics.data;

  return (
    <>
      <PageHeader
        title="Overview"
        description="How Jane is performing across all calls."
        onRefresh={() => {
          void metrics.reload();
          void recent.reload();
        }}
      />
      <LoadState loading={metrics.loading && !m} error={metrics.error} />
      {m ? (
        <div className={styles.tiles}>
          <Tile label="Total conversations" value={fmtInt(m.total_conversations)} sub={`${m.active} active now`} />
          <Tile label="Resolution rate" value={fmtPct(m.resolution_rate)} sub={`${m.resolved} resolved`} />
          <Tile label="Escalation rate" value={fmtPct(m.escalation_rate)} sub={`${m.escalated} escalated`} />
          <Tile label="Error rate" value={fmtPct(m.error_rate)} sub={`${m.errors} with errors`} />
          <Tile label="Avg turns / conversation" value={m.avg_turns.toFixed(1)} />
          <Tile label="Avg call duration" value={fmtSeconds(m.avg_duration_seconds)} sub="Completed calls" />
          <Tile label="Tickets" value={fmtInt(m.total_tickets)} />
          <Tile label="Escalations" value={fmtInt(m.total_escalations)} />
        </div>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent conversations</h2>
        <div className="card">
          <LoadState loading={recent.loading && !recent.data} error={recent.error} empty={recent.data?.length === 0} />
          {recent.data?.length ? <ConversationTable rows={recent.data} /> : null}
        </div>
      </section>
    </>
  );
}
