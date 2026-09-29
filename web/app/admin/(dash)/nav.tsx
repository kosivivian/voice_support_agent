"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "../admin.module.css";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/conversations", label: "Conversations" },
  { href: "/admin/tickets", label: "Tickets" },
  { href: "/admin/escalations", label: "Escalations" },
  { href: "/admin/evaluations", label: "Evaluations" },
  { href: "/admin/retrieval", label: "Retrieval logs" },
  { href: "/admin/costs", label: "Costs" },
  { href: "/admin/errors", label: "Error logs" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Admin">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={`${styles.navLink} ${active ? styles.navActive : ""}`} aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.replace("/admin/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
