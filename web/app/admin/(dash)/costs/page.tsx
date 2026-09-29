"use client";

import Link from "next/link";
import { LoadState, PageHeader, Tile } from "@/components/admin";
import { fmtInt, fmtUsd, shortId } from "@/lib/format";
import { useAdminData } from "@/lib/useAdmin";
import styles from "../../admin.module.css";

interface Row {
  turns: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
}
interface Costs {
  by_model: (Row & { model: string })[];
  by_conversation: (Row & { conversation_id: string })[];
  totals: Row;
  note: string;
}

function Cells({ r }: { r: Row }) {
  return (
    <>
      <td className={styles.num}>{fmtInt(r.turns)}</td>
      <td className={styles.num}>{fmtInt(r.input)}</td>
      <td className={styles.num}>{fmtInt(r.output)}</td>
      <td className={styles.num}>{fmtInt(r.cache_read)}</td>
      <td className={styles.num}>{fmtInt(r.cache_write)}</td>
      <td className={styles.num}>{fmtUsd(r.cost_usd)}</td>
    </>
  );
}

const HEAD = ["Turns", "Input tokens", "Output tokens", "Cache read", "Cache write", "Est. cost"];

export default function CostsPage() {
  const { data, error, loading, reload } = useAdminData<Costs>("costs");
  return (
    <>
      <PageHeader title="Costs" description={data?.note ?? "Token usage per conversation and cumulative totals by model."} onRefresh={reload} />
      <LoadState loading={loading && !data} error={error} />
      {data ? (
        <>
          <div className={styles.tiles}>
            <Tile label="Estimated total cost" value={fmtUsd(data.totals.cost_usd)} />
            <Tile label="Agent turns" value={fmtInt(data.totals.turns)} />
            <Tile label="Input tokens" value={fmtInt(data.totals.input + data.totals.cache_read + data.totals.cache_write)} sub={`${fmtInt(data.totals.cache_read)} from cache`} />
            <Tile label="Output tokens" value={fmtInt(data.totals.output)} />
          </div>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>By model</h2>
            <div className={`card ${styles.tableWrap}`}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Model</th>
                    {HEAD.map((h) => (
                      <th key={h} className={styles.num}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.by_model.map((m) => (
                    <tr key={m.model}>
                      <td>{m.model}</td>
                      <Cells r={m} />
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.by_model.length === 0 ? <div className={styles.empty}>No agent turns yet.</div> : null}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>By conversation</h2>
            <div className={`card ${styles.tableWrap}`}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Conversation</th>
                    {HEAD.map((h) => (
                      <th key={h} className={styles.num}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.by_conversation.map((c) => (
                    <tr key={c.conversation_id}>
                      <td className="mono-id">
                        <Link href={`/admin/conversations/${c.conversation_id}`}>{shortId(c.conversation_id)}</Link>
                      </td>
                      <Cells r={c} />
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.by_conversation.length === 0 ? <div className={styles.empty}>No agent turns yet.</div> : null}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
