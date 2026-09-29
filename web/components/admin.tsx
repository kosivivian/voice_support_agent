"use client";

import styles from "@/app/admin/admin.module.css";

export function PageHeader({ title, description, onRefresh }: { title: string; description?: string; onRefresh?: () => void }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {description ? (
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            {description}
          </p>
        ) : null}
      </div>
      {onRefresh ? (
        <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
          Refresh
        </button>
      ) : null}
    </div>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  const key = value.replace(/\s+/g, "_").toLowerCase();
  return <span className={`badge badge-${key}`}>{value}</span>;
}

export function LoadState({ loading, error, empty }: { loading: boolean; error: string | null; empty?: boolean }) {
  if (loading) return <div className={styles.empty}>Loading…</div>;
  if (error) return <div className={`${styles.empty} error-text`}>{error}</div>;
  if (empty) return <div className={styles.empty}>Nothing here yet.</div>;
  return null;
}

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={`card ${styles.tile}`}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
      {sub ? <div className={styles.tileSub}>{sub}</div> : null}
    </div>
  );
}
