# RelayPay MCP Server

The MCP server behind **Jane**, RelayPay's AI voice support agent. It is the only part of the system that reads customer, transaction and payout data. It exposes 8 tools over **Streamable HTTP** (stateless; no session handshake needed).

| Tool | What it does |
| --- | --- |
| `lookup_customer` | Step 1 of caller verification: emails a 6-digit code to the account with this email. Returns the same answer whether or not the email is registered. |
| `verify_code` | Step 2: checks the code the caller read out or typed (spoken digits are fine). On success the conversation is marked verified and the account summary is returned. 5 tries per code, 3 codes per call, 10-minute expiry. |
| `lookup_transaction` | A transaction on the **verified caller's** account by reference (e.g. `TXN-9001`), or their recent ones. The account comes from the verified conversation, never from tool input; before verification it returns `not_verified`. |
| `lookup_payout` | Same as above for payouts (e.g. `PAY-7001`). |
| `retrieve_knowledge` | Semantic search over the RelayPay knowledge base (Voyage embeddings + pgvector). Chunks below the similarity threshold are withheld so the agent can't answer from weak matches. |
| `create_ticket` | Creates a support ticket. |
| `create_escalation` | Escalates an existing ticket (requires `ticket_id`) and emails the support team. |
| `log_conversation_event` | Writes an audit event (identity verified, out-of-scope decline, escalation, and so on). |

Every lookup result includes `agent_guidance` (what the agent may say and when to offer escalation) and `is_stale` (the estimated arrival date has passed and the item is still not complete). Every call is logged to `tool_calls`, and every search to `retrieval_logs`.

**Endpoint:** `POST /mcp`. **Auth:** an `x-api-key: <MCP_API_KEY>` header or `Authorization: Bearer <MCP_API_KEY>`; requests without it get `401`. **Health:** `GET /health`.

---

## Option A: test the deployed server (no setup)

- URL: `https://voicesupportagent-production.up.railway.app/mcp`
- API key: provided separately with the submission

**With MCP Inspector (UI):**

```bash
npx @modelcontextprotocol/inspector
```

Choose transport **Streamable HTTP**, paste the URL, and add the header `x-api-key` with the key. Then **Connect → List Tools**.

**With curl:**

```bash
URL=https://voicesupportagent-production.up.railway.app/mcp
KEY=the-api-key

# List the tools
curl -s -X POST $URL -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool. x-conversation-id ties verification to one call: use any new UUID,
# and keep the same one for lookup_customer -> verify_code -> lookup_transaction.
CALL=$(node -e "console.log(crypto.randomUUID())")
curl -s -X POST $URL -H "x-api-key: $KEY" -H "x-conversation-id: $CALL" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lookup_customer","arguments":{"email":"amara@lagosledger.example"}}}'
```

Responses arrive as one server-sent event (`data: {...}`).

---

## Option B: run it yourself

**Requirements:** Node 22+, a free [Supabase](https://supabase.com) project, a [Voyage AI](https://www.voyageai.com) API key. Resend is optional; without it, escalations are saved but no email is sent.

```bash
git clone https://github.com/kosivivian/voice_support_agent.git
cd voice_support_agent
npm ci
cp .env.example .env
```

1. **Fill in `.env`.** The MCP server needs:

   | Variable | Required | Value |
   | --- | --- | --- |
   | `MCP_API_KEY` | yes | Any long random string; clients must send it |
   | `SUPABASE_URL` | yes | Supabase → Project Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | yes | Same page (service role key) |
   | `VOYAGE_API_KEY` | yes | Voyage AI dashboard |
   | `VOYAGE_MODEL` | no | Default `voyage-3.5-lite` |
   | `KB_SIMILARITY_THRESHOLD` | no | Default `0.5` |
   | `RESEND_API_KEY`, `EMAIL_FROM` | for codes | Sends verification codes and escalation emails. `EMAIL_FROM` must use a domain verified in Resend |
   | `SUPPORT_EMAIL` | no | Extra recipient for escalation emails |
   | `OTP_SECRET` | recommended | Secret for hashing verification codes (falls back to `MCP_API_KEY`) |
   | `DEMO_OTP_INBOX` | for testing | Inbox that receives codes for the `.example` test customers |

2. **Create the schema.** In Supabase → SQL Editor, run the files in [`supabase/migrations/`](../supabase/migrations/) in order, `001` to `005`.

3. **Load the data:**

   ```bash
   npm run seed        # customers, transactions, payouts from the course CSVs
   npm run kb:ingest   # chunks and embeds the knowledge base (needs VOYAGE_API_KEY)
   ```

4. **Start the server:**

   ```bash
   npm run dev:mcp     # http://localhost:8788/mcp
   ```

   Or build and run it as in production:

   ```bash
   npm run build -w mcp-server && npm run start -w mcp-server
   ```

5. **Test it.** Use the curl commands above with `URL=http://localhost:8788/mcp` and your `MCP_API_KEY`.

---

## Example calls (seed data)

| Tool | Arguments | Expected |
| --- | --- | --- |
| `lookup_customer` | `{"email":"amara@lagosledger.example"}` | `code_sent: true` (code emailed to `DEMO_OTP_INBOX`, since this is a test address) |
| `lookup_customer` | `{"email":"nobody@example.com"}` | The same `code_sent: true` reply: nothing reveals the email isn't registered |
| `lookup_transaction` | `{"transaction_reference":"TXN-9001"}` before verifying | `not_verified` |
| `verify_code` | `{"code":"000000"}` | `wrong_code`, `attempts_left: 4` |
| `verify_code` | `{"code":"<code from the email>"}` | `verified: true`, `CUS-1001`, Growth plan |
| `lookup_transaction` | `{"transaction_reference":"TXN-9001"}` after verifying | Processing, overdue |
| `lookup_transaction` | `{"transaction_reference":"TXN-9002"}` after verifying as Amara | Not found (belongs to another customer) |
| `retrieve_knowledge` | `{"query":"What fees apply to international payments?"}` | Confident match from the knowledge base |
| `retrieve_knowledge` | `{"query":"What is the weather in Lagos?"}` | `has_confident_match: false` |
| `create_ticket` | `{"user_name":"Test","user_email":"test@example.com","subject":"Test","description":"Grader test"}` | Returns `ticket_id` |
| `create_escalation` | `{"ticket_id":"<from above>","user_name":"Test","user_email":"test@example.com","category":"refund","reason":"Grader test"}` | Escalation created |

## Production deployment (Railway)

- Root directory: repo root
- Build: `npm ci && npm run build -w mcp-server`
- Start: `npm run start -w mcp-server`
- Variables: as in the table above, plus `NODE_ENV=production`. In production, plain-HTTP requests are rejected.
