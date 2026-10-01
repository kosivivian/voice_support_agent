import Image from "next/image";

export function Logo({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Image src="/relaypay-logo.png" alt="RelayPay" width={502} height={94} priority style={{ height: 28, width: "auto" }} />
      {subtitle ? <span style={{ color: "#5b6472", fontSize: 14, borderLeft: "1px solid #cfd4dc", paddingLeft: 12 }}>{subtitle}</span> : null}
    </div>
  );
}
