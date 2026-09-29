import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

/**
 * Call-path client. Uses the anon key; RLS only allows it to INSERT turns,
 * tool calls and chat-fallback tickets, plus the narrow conversation RPCs.
 */
export const anonDb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false },
});

/** Admin-API client (JWT-protected routes only). */
export const adminDb = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
