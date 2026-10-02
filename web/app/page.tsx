import { Logo } from "@/components/Logo";
import { SupportPanel } from "@/components/SupportPanel";

export default function HomePage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 20px" }}>
          <Logo subtitle="Support" />
        </div>
      </header>
      <main style={{ flex: 1, width: "100%", maxWidth: 1200, margin: "0 auto", padding: "40px 20px" }}>
        <SupportPanel />
      </main>
      <footer style={{ maxWidth: 1200, width: "100%", margin: "0 auto", padding: "16px 20px 28px" }} className="muted small">
        Support hours: Monday to Friday, 09:00 – 17:00 WAT. Jane is available at all times.
      </footer>
    </div>
  );
}
