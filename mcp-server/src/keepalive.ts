import { Agent, setGlobalDispatcher } from "undici";

// Node's fetch closes idle connections after 4 s, so most call turns would pay
// a fresh TLS handshake to Supabase and Voyage. Keep them open for a minute.
setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 300_000, connections: 64 }));
