export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "—";
  return fmtSeconds((Date.parse(end) - Date.parse(start)) / 1000);
}

export function fmtSeconds(total: number): string {
  if (!Number.isFinite(total) || total < 0) return "—";
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

export const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
export const fmtUsd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;
export const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : "—");
