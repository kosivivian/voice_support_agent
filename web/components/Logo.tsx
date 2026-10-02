import Image from "next/image";

// `stacked` puts the subtitle under the logo, for narrow spaces like the admin sidebar.
export function Logo({ subtitle, stacked = false }: { subtitle?: string; stacked?: boolean }) {
  const logo = <Image src="/relaypay-logo.png" alt="RelayPay" width={502} height={94} priority style={{ height: stacked ? 26 : 28, width: "auto" }} />;
  if (stacked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        {logo}
        {subtitle ? (
          <span style={{ color: "#5b6472", fontSize: 12, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{subtitle}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {logo}
      {subtitle ? <span style={{ color: "#5b6472", fontSize: 14, borderLeft: "1px solid #cfd4dc", paddingLeft: 12 }}>{subtitle}</span> : null}
    </div>
  );
}
