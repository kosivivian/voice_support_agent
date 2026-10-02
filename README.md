# RelayPay Support Agent (Jane)

A first-line AI voice support agent for RelayPay. Customers talk to **Jane** in the browser. She answers from the approved knowledge base, verifies callers by email before any account lookup, creates tickets and escalations, and logs everything to Supabase for the admin dashboard.

```
Browser (Next.js, Vercel)
  ├─ "/"       Talk to Jane (Vapi web SDK) + one-way chat widget / fallback form
  └─ "/admin"  Dashboard (httpOnly session cookie → proxied to the webhook admin API)
        │
Vapi ── Custom LLM: POST /vapi/chat/completions (full transcript every turn)
        │
Webhook server (Express + Claude Agent SDK, Railway)
  ├─ runs Jane per turn (stateless; conversation_id = uuidv5(Vapi call id))
  ├─ in-process tool: send_chat_message → SSE /api/chat-stream/:callId
  ├─ /vapi/events: end-of-call report → summary + final status
  ├─ /api/fallback-ticket (chat form when voice fails)
  └─ /admin/api/* (JWT, bcrypt login)
        │  HTTPS + x-api-key, x-conversation-id / x-turn-id headers
MCP server (Streamable HTTP, Railway) — the only component reading seed data
  lookup_customer · lookup_transaction · lookup_payout · retrieve_knowledge
  create_ticket · create_escalation · log_conversation_event
        │
Supabase (Postgres + pgvector 1024-dim, Voyage voyage-3.5-lite embeddings)
```

## Repository layout

| Folder | What it is |
| --- | --- |
| `mcp-server/` | MCP server (`@modelcontextprotocol/server` v2), all 7 tools, tool-call + retrieval logging, escalation emails |
| `webhook/` | Vapi custom-LLM endpoint, Claude Agent SDK runner, chat push (SSE), fallback tickets, admin API |
| `web/` | Next.js client page and admin dashboard |
| `supabase/migrations/` | Full schema, RLS policies, RPCs, `match_knowledge` vector search |
| `scripts/` | Seeding, KB ingestion, retrieval calibration, admin user creation |
| `docs/VAPI_SETUP.md` | Step-by-step Vapi assistant configuration |
| `aat-c3-week-6-support-agent-main/assets/` | Source material: knowledge base, seed CSVs, rules, test scenarios |

## Setup

Prerequisites: Node 22+, a Supabase project, and API keys for Anthropic, Voyage AI, Vapi and Resend.

```bash
npm install
cp .env.example .env          # fill in the values
```

1. **Database.** In Supabase, go to SQL Editor, paste `supabase/migrations/001_schema.sql` and run it.
2. **Seed data.** Run `npm run seed`. It loads customers, transactions and payouts from the CSVs, the customer-support staff record (`SUPPORT_EMAIL`) and the 9 evaluation scenarios.
3. **Knowledge base.** Run `npm run kb:ingest` to chunk and embed `relaypay-knowledge-base.md`. Re-run it whenever the KB changes; no restart is needed.
4. **Calibrate grounding.** Run `npm run kb:test` and check that in-scope questions score above `KB_SIMILARITY_THRESHOLD` and off-topic ones score below it. Adjust the value if needed.
5. **Admin user.** Run `npm run create-admin -- you@relaypay.example "long-password"`.
6. **Run locally**, in three terminals:
   ```bash
   npm run dev:mcp        # :8788
   npm run dev:webhook    # :8787
   npm run dev:web        # :3000  (needs web/.env.local with the NEXT_PUBLIC_* and WEBHOOK_URL values)
   ```
   Vapi must reach the webhook over HTTPS. For local calls run `ngrok http 8787` and use that URL.
7. **Vapi.** Follow [docs/VAPI_SETUP.md](docs/VAPI_SETUP.md).
8. **Live admin updates (Supabase Realtime).** Run `supabase/migrations/002_admin_live_updates.sql` in the Supabase SQL Editor. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the web app (`web/.env.local` locally, Vercel in production). Every change to the logged tables then broadcasts a `{ table, type }` signal on the `admin-dashboard` Realtime channel, and open admin pages re-fetch automatically.

## Deploy

**MCP server (Railway service 1).** Root directory: repo root.
- Build: `npm ci && npm run build -w mcp-server`
- Start: `npm run start -w mcp-server`
- Variables: `MCP_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY`, `VOYAGE_MODEL`, `KB_SIMILARITY_THRESHOLD`, `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL`, `NODE_ENV=production`
- Endpoint: `https://<mcp>.up.railway.app/mcp`. Health check: `/health`.

**Webhook server (Railway service 2).** Root directory: repo root.
- Build: `npm ci && npm run build -w webhook`
- Start: `npm run start -w webhook`
- Variables: `ANTHROPIC_API_KEY`, `AGENT_MODEL`, `AGENT_EFFORT`, `SUMMARY_MODEL`, `MCP_SERVER_URL` (the MCP service URL, without `/mcp`), `MCP_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_JWT_SECRET`, `VAPI_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL`, `WEB_ORIGIN` (your Vercel URL), `NODE_ENV=production`

**Web (Vercel).** Root directory: `web`.
- Variables: `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_ASSISTANT_ID`, `NEXT_PUBLIC_WEBHOOK_URL`, `WEBHOOK_URL` (both set to the webhook Railway URL), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Key behaviors

- **Grounding.** `retrieve_knowledge` withholds the content of chunks below the similarity threshold, so Jane cannot answer from low-confidence results. Every search is written to `retrieval_logs`.
- **Identity.** Email is the only identifier. Lookups require the `customer_id` from `lookup_customer`, and records belonging to another customer come back as not found. `account_status`, `kyc_status` and `support_notes` are never spoken.
- **Stale data.** The MCP server computes `is_stale`: estimated arrival (payouts: `scheduled_for`) is before today in WAT, and the status is processing, delayed or review required. Jane escalates these with `stale_data` instead of reading them out.
- **Escalations.** `create_ticket` runs first, then `create_escalation` (which requires `ticket_id`). The support inbox is emailed and the conversation is marked `escalated`.
- **Limits.** 10 customer turns or 8 minutes. Wrap-up starts at 7 minutes (`WRAP_UP_AFTER_SECONDS`), and Vapi's `maxDurationSeconds=480` is the hard stop.
- **Failures.** If the Agent SDK or MCP server fails, Jane gives the technical-issue line, support is emailed, and the turn and conversation are logged with `error` status. Logging writes are fire-and-forget.
- **Security.** The MCP server needs `MCP_API_KEY` (401 without it) and rejects non-HTTPS requests in production. Call handlers use the anon key: RLS allows inserts only, and conversation updates go through narrow `SECURITY DEFINER` RPCs. Only the JWT-protected admin API uses the service role key. Admin sessions last 8 hours.

## Test scenarios

`npm run seed` creates the 9 course scenarios in `evaluations`. After each test call, open `/admin/evaluations`, click **Record result**, and enter your name, the date, what Jane actually did, and pass or fail. Useful seed identities:

| Customer | Email | Notes |
| --- | --- | --- |
| Amara Okafor, LagosLedger | amara@lagosledger.example | Growth. TXN-9001 / PAY-7001 are processing past their dates, so they are stale and escalate |
| Daniel Mwangi, NairobiOps | daniel@nairobiops.example | Starter. TXN-9002 is completed (read aloud) |
| Efua Mensah, AccraStack | efua@accrastack.example | Scale, restricted. PAY-7002 is review required and stale |
| Amina Jacobs, CapeCloud | amina@capecloud.example | Growth. TXN-9004 / PAY-7003 failed (beneficiary details) |
| Patrick Ndayisaba, KigaliWorks | patrick@kigaliworks.example | Starter. TXN-9005 is delayed past its date, so it is stale |
