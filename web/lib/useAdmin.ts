"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, { ...init, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = "/admin/login";
    throw new Error("Not signed in");
  }
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function useAdminData<T>(path: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminRequest<T>(path));
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.message === "Not signed in") router.replace("/admin/login");
      else setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [path, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}
