export function Logo({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="6" fill="#12305f" />
        <path d="M8 19V9h6.2a3.6 3.6 0 0 1 0 7.2H11" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15 16.2 19.5 19" stroke="#5fc4cc" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span style={{ fontWeight: 600, fontSize: 17, color: "#0d2549", letterSpacing: "-0.01em" }}>RelayPay</span>
      {subtitle ? <span style={{ color: "#5b6472", fontSize: 14, borderLeft: "1px solid #cfd4dc", paddingLeft: 10 }}>{subtitle}</span> : null}
    </div>
  );
}
