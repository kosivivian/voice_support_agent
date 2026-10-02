import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ADMIN_COOKIE, webhookUrl } from "@/lib/adminServer";
import styles from "../admin.module.css";
import { AdminNav, SignOutButton } from "./nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) redirect("/admin/login");

  // Verify the session with the webhook server (which holds the JWT secret).
  const me = await fetch(`${webhookUrl()}/admin/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!me || me.status === 401) redirect("/admin/login");
  const email = me.ok ? ((await me.json()) as { email: string }).email : "";

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div style={{ padding: "0 6px" }}>
          <Logo subtitle="Admin" stacked />
        </div>
        <AdminNav />
        <div className={styles.sidebarFooter}>
          <span className="muted small" style={{ wordBreak: "break-all" }}>
            {email}
          </span>
          <SignOutButton />
        </div>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
