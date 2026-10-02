"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { onAdminDataChange } from "./adminLive";

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

// Several rows change per call turn; batch them into one re-fetch.
const CHANGE_DEBOUNCE_MS = 800;

export function useAdminData<T>(path: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasData = useRef(false);

  const fetchData = useCallback(
    async (background: boolean) => {
      if (!background) setLoading(true);
      try {
        setData(await adminRequest<T>(path));
        hasData.current = true;
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.message === "Not signed in") router.replace("/admin/login");
        // A failed background refresh keeps the last good data on screen.
        else if (!background || !hasData.current) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!background) setLoading(false);
      }
    },
    [path, router],
  );

  useEffect(() => {
    hasData.current = false;
    void fetchData(false);
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onAdminDataChange(() => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => void fetchData(true), CHANGE_DEBOUNCE_MS);
    });
    const onVisible = () => {
      if (!document.hidden) void fetchData(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (pending) clearTimeout(pending);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchData]);

  const reload = useCallback(() => fetchData(false), [fetchData]);
  return { data, error, loading, reload };
}
