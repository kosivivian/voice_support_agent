"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadState, PageHeader, StatusBadge } from "@/components/admin";
import { shortId } from "@/lib/format";
import type { Evaluation } from "@/lib/types";
import { adminRequest, useAdminData } from "@/lib/useAdmin";
import styles from "../../admin.module.css";

type Draft = Pick<Evaluation, "scenario_name" | "tester_name" | "date_run" | "conversation_id" | "expected_behavior" | "actual_behavior" | "result" | "notes">;

const today = () => new Date().toISOString().slice(0, 10);

export default function EvaluationsPage() {
  const { data, error, loading, reload } = useAdminData<Evaluation[]>("evaluations");
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const passed = data?.filter((e) => e.result === "pass").length ?? 0;
  const marked = data?.filter((e) => e.result).length ?? 0;

  return (
    <>
      <PageHeader
        title="Evaluations"
        description={data ? `Test scenario results. ${passed} passed of ${marked} marked (${data.length} scenarios).` : "Test scenario results."}
        onRefresh={reload}
      />
      <LoadState loading={loading && !data} error={error} empty={data?.length === 0} />
      {data?.map((e) =>
        editing === e.evaluation_id ? (
          <EvalEditor
            key={e.evaluation_id}
            initial={e}
            onCancel={() => setEditing(null)}
            onSave={async (draft) => {
              await adminRequest(`evaluations/${e.evaluation_id}`, { method: "PATCH", body: JSON.stringify(draft) });
              setEditing(null);
              await reload();
            }}
          />
        ) : (
          <EvalCard key={e.evaluation_id} e={e} onEdit={() => setEditing(e.evaluation_id)} />
        ),
      )}
      {editing === "new" ? (
        <EvalEditor
          initial={null}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            await adminRequest("evaluations", { method: "POST", body: JSON.stringify(draft) });
            setEditing(null);
            await reload();
          }}
        />
      ) : data ? (
        <button className="btn btn-secondary" onClick={() => setEditing("new")}>
          Add evaluation record
        </button>
      ) : null}
    </>
  );
}

function EvalCard({ e, onEdit }: { e: Evaluation; onEdit: () => void }) {
  return (
    <div className="card" style={{ padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
        <h2 style={{ fontSize: 16 }}>
          {e.scenario_number ? `${e.scenario_number}. ` : ""}
          {e.scenario_name}
        </h2>
        {e.result ? <StatusBadge value={e.result} /> : <span className="badge">Not run</span>}
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} onClick={onEdit}>
          {e.result ? "Edit" : "Record result"}
        </button>
      </div>
      <div className="small" style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr)", gap: "6px 12px" }}>
        <span className="muted">Tester</span>
        <span>{e.tester_name ?? "—"}</span>
        <span className="muted">Date run</span>
        <span>{e.date_run ?? "—"}</span>
        <span className="muted">Conversation</span>
        <span className="mono-id">{e.conversation_id ? <Link href={`/admin/conversations/${e.conversation_id}`}>{shortId(e.conversation_id)}</Link> : "—"}</span>
        <span className="muted">Expected</span>
        <span>{e.expected_behavior}</span>
        <span className="muted">Actual</span>
        <span style={{ whiteSpace: "pre-wrap" }}>{e.actual_behavior ?? "—"}</span>
        <span className="muted">Notes</span>
        <span style={{ whiteSpace: "pre-wrap" }}>{e.notes ?? "—"}</span>
      </div>
    </div>
  );
}

function EvalEditor({ initial, onSave, onCancel }: { initial: Evaluation | null; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>({
    scenario_name: initial?.scenario_name ?? "",
    tester_name: initial?.tester_name ?? "",
    date_run: initial?.date_run ?? today(),
    conversation_id: initial?.conversation_id ?? "",
    expected_behavior: initial?.expected_behavior ?? "",
    actual_behavior: initial?.actual_behavior ?? "",
    result: initial?.result ?? null,
    notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const blank = (s: string | null) => (s && s.trim() ? s.trim() : null);
      await onSave({
        ...draft,
        tester_name: blank(draft.tester_name),
        date_run: blank(draft.date_run),
        conversation_id: blank(draft.conversation_id),
        actual_behavior: blank(draft.actual_behavior),
        notes: blank(draft.notes),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <form className="card" style={{ padding: "16px 18px", marginBottom: 12 }} onSubmit={submit}>
      <div className={styles.evalForm}>
        <div className={`field ${styles.evalFull}`}>
          <label htmlFor="ev-name">Scenario name</label>
          <input id="ev-name" className="input" value={draft.scenario_name} onChange={(e) => set("scenario_name", e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="ev-tester">Tester name</label>
          <input id="ev-tester" className="input" value={draft.tester_name ?? ""} onChange={(e) => set("tester_name", e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="ev-date">Date run</label>
          <input id="ev-date" className="input" type="date" value={draft.date_run ?? ""} onChange={(e) => set("date_run", e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="ev-conv">Conversation ID (optional)</label>
          <input id="ev-conv" className="input" value={draft.conversation_id ?? ""} onChange={(e) => set("conversation_id", e.target.value)} placeholder="Paste from the Conversations page" />
        </div>
        <div className="field">
          <label htmlFor="ev-result">Result</label>
          <select id="ev-result" className="select" value={draft.result ?? ""} onChange={(e) => set("result", (e.target.value || null) as Draft["result"])} required>
            <option value="">Select…</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </select>
        </div>
        <div className={`field ${styles.evalFull}`}>
          <label htmlFor="ev-expected">Expected behavior</label>
          <textarea id="ev-expected" className="textarea" value={draft.expected_behavior} onChange={(e) => set("expected_behavior", e.target.value)} required />
        </div>
        <div className={`field ${styles.evalFull}`}>
          <label htmlFor="ev-actual">Actual behavior (what Jane said and did)</label>
          <textarea id="ev-actual" className="textarea" value={draft.actual_behavior ?? ""} onChange={(e) => set("actual_behavior", e.target.value)} required />
        </div>
        <div className={`field ${styles.evalFull}`}>
          <label htmlFor="ev-notes">Notes (edge cases)</label>
          <textarea id="ev-notes" className="textarea" value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
