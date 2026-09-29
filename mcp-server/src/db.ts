import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

// The MCP server is the only component that reads seed data, so it holds the
// service role key.
export const db = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
