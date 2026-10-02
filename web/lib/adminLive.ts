"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

// One shared Supabase Realtime subscription per tab. The database broadcasts
// { table, type } on "admin-dashboard" whenever logged data changes; listeners
// re-fetch through the admin API. Listeners also fire on (re)subscribe, in
// case changes were missed while disconnected.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Listener = () => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<(live: boolean) => void>();
let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let live = false;

function setLive(next: boolean) {
  live = next;
  statusListeners.forEach((l) => l(next));
}

function connect() {
  if (channel || typeof window === "undefined" || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  channel = client
    .channel("admin-dashboard")
    .on("broadcast", { event: "change" }, () => listeners.forEach((l) => l()))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setLive(true);
        listeners.forEach((l) => l());
      } else {
        setLive(false);
      }
    });
}

function disconnectIfIdle() {
  if (listeners.size === 0 && statusListeners.size === 0 && channel && client) {
    void client.removeChannel(channel);
    channel = null;
    setLive(false);
  }
}

export function onAdminDataChange(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    disconnectIfIdle();
  };
}

export function useLiveStatus(): boolean {
  const [state, setState] = useState(live);
  useEffect(() => {
    statusListeners.add(setState);
    connect();
    setState(live);
    return () => {
      statusListeners.delete(setState);
      disconnectIfIdle();
    };
  }, []);
  return state;
}
