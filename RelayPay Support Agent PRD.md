# RelayPay Support Agent PRD

Sep 29, 2026 · @Someone

## 1. Executive Summary

RelayPay is building a first-line AI voice support agent to handle inbound customer queries for its cross-border payments and invoicing platform, which serves African startups and SMEs across Nigeria, Kenya, Ghana, South Africa, and Rwanda.

The agent — named **Jane** — is the first point of contact for all support queries. She answers from an approved knowledge base, looks up customer and transaction data via secure tools, creates support tickets, and escalates urgent or sensitive cases to the customer support team via email. When voice is unavailable, a chat widget allows customers to leave a message. An admin dashboard gives the RelayPay team full visibility into all conversations, tickets, escalations, and system health.

**What this system delivers:**

- An always-on AI voice support agent (Jane) accessible via a public web interface
- Secure customer identity verification via email lookup before any account data is shared
- Automated ticket creation and escalation routing to the customer support team
- A semantic knowledge base retrieval system grounded strictly to approved content
- A dual-role web application: public client interface and protected admin dashboard
- Full conversation logging, tool call tracing, and evaluation records in Supabase

**Scope boundary:** This build covers the voice agent, web interface, MCP server, and admin dashboard. Phone number integration, multilingual support, and an automated evaluation judge are explicitly out of scope for this version.

## 2. System Architecture

The system has four distinct layers that communicate in sequence on every voice turn.

**Layer 1 — Client interface (Next.js web app)** The public-facing page hosts the Vapi voice widget and the chat fallback widget. It serves two routes: `/` for customers and `/admin` for the RelayPay team (protected by login).

**Layer 2 — Voice layer (Vapi)** Vapi handles speech-to-text, text-to-speech, and call session management. On each customer turn, Vapi sends a webhook POST to the backend server carrying the full conversation transcript up to that point plus the new user message. Vapi expects a response within its timeout window containing Jane's next spoken reply.

**Layer 3 — Backend server (Node.js/Express webhook server)** This server receives Vapi webhooks, instantiates the Claude Agent SDK with the current conversation history, and returns Jane's response to Vapi. It also handles: admin authentication, serving the admin dashboard API, and writing conversation records to Supabase. The server is stateless per request — conversation history is passed in full by Vapi on every turn.

**Layer 4 — MCP server (cloud-hosted, HTTPS)** The Claude Agent SDK connects to a separate cloud-hosted MCP server over HTTPS. The MCP server is the only component that has a direct connection to Supabase. It exposes six tools: customer lookup, transaction lookup, payout lookup, knowledge base retrieval, ticket creation, and escalation creation.

**Data store — Supabase (PostgreSQL + pgvector)** Supabase holds all persistent data: seed tables (customers, transactions, payouts), knowledge base embeddings, and runtime tables (conversations, turns, tool calls, retrieval logs, tickets, escalations, evaluations, staff).

**Request flow per voice turn:**

1. Customer speaks → Vapi transcribes
2. Vapi POSTs to webhook server with full transcript
3. Webhook server calls Claude Agent SDK (with conversation history)
4. Claude Agent SDK reasons, calls MCP tools as needed (each tool hits Supabase)
5. Claude Agent SDK returns Jane's response text
6. Webhook server returns response to Vapi
7. Vapi speaks Jane's response to the customer
8. Webhook server writes the turn record to Supabase asynchronously (fire-and-forget — a logging failure never aborts the call)

**Chat widget fallback flow:** If the voice call fails to initialize, the UI degrades to a message form. The customer's submitted message creates a support ticket directly in Supabase and triggers a notification email to the customer support team. Jane is not involved in this path.

## 3. User Roles

The application has two roles with completely separate interfaces.

**Client (public)** Accesses the root route `/`. No login required. Can initiate a voice call with Jane, use the chat fallback widget if voice fails, and receive text messages pushed by Jane for information she cannot speak aloud (e.g. transaction reference numbers). Has no visibility into tickets, escalations, conversation logs, or admin data.

**Admin (internal — RelayPay team)** Accesses `/admin` behind a login. Admin accounts are seeded manually in Supabase — there is no public sign-up flow. Can view all conversations, all turns within each conversation, all tickets and escalations, all retrieval logs, system metrics, token usage/costs, and error logs. Cannot modify conversation data. Admin is the only role that can see the evaluation table and mark test runs as pass or fail.

## 4. Agent Identity and Behavior

**Persona:** Name: Jane. Role: AI support assistant for RelayPay. Language: English only.

**Opening greeting (exact script):** Hi, this is Jane, an AI assistant for RelayPay. How may I help you? Jane must identify herself as an AI in the greeting. She does not pretend to be human under any circumstances.

**Decision tree — four response paths:**

1. **Answer** — The query is covered by the approved knowledge base and requires no account data. Jane retrieves the relevant knowledge chunk via the `retrieve_knowledge` tool and responds strictly from it. She does not infer, extrapolate, or add information not present in the retrieved content.
2. **Clarify** — The query is ambiguous. Jane asks one clarifying question per turn, up to a maximum of three clarifying questions across the conversation. If the issue remains unresolved after three clarifying turns, Jane creates a ticket and escalates.
3. **Lookup then respond** — The query requires account, transaction, or payout data. Jane first verifies the caller's identity via email (see Section 5), then calls the appropriate MCP lookup tool. For payouts or transactions with a passed estimated\_arrival date and a status of processing, delayed, or review required, Jane does not read the stale data aloud — she creates a ticket and escalates instead.
4. **Escalate** — The query matches an escalation trigger (see Section 7), cannot be resolved within the clarification limit, or hits the turn/time limit. Jane creates a ticket first, then an escalation linked to that ticket, tells the customer a specialist will follow up, and does not attempt further resolution.

**Grounding rule:** Jane is strictly grounded to the approved knowledge base. She does not answer questions whose topic is not covered by retrieved content. If a query is outside the knowledge base, she says she is unable to help with that specific topic and offers to create a ticket for the customer support team.

**Fallback on backend failure:** If the Claude Agent SDK or MCP server returns an error, Jane says she is experiencing a technical issue and that the support team will follow up. A notification email is sent to the customer support team. The conversation is logged with an error status.

**Mid-conversation topic switch:** If a customer switches to an escalation-worthy topic mid-conversation, Jane stops the current thread, triggers the escalation flow, and closes the call. The conversation's final status is escalated. The conversation summary captures everything discussed before the switch.

**One-way text push:** For information Jane should not speak aloud (transaction reference numbers, account identifiers), she says she will send it as a text in the chat and pushes a formatted message to the chat widget. This is not a two-way text conversation — it is a one-way delivery channel.

## 5. Identity Verification and Lookup Flow

No account, transaction, or payout data is accessed until the caller's identity is verified. Identity verification is email-first.

**Verification flow:**

1. Jane asks the customer for their email address.
2. Jane calls `lookup_customer` with the provided email.
3. If a record is found, Jane confirms the email and the customer's current plan back to the caller: e.g. "I've found your account under \[email\] on the \[plan\] plan — is that correct?"
4. The customer confirms. Only after confirmation does Jane proceed with the original query.
5. If no record is found for the email, Jane tells the customer she cannot find an account with that email and offers to create a ticket.

**What Jane may say aloud after verification:**

- The customer's email address (for confirmation)
- The customer's current plan
- Transaction or payout status (if not stale)
- General information from the knowledge base

**What Jane must never say aloud:**

- `kyc_status`
- `account_status`
- `support_notes` (agent context only — never spoken)
- Raw transaction reference numbers or account IDs (pushed via text widget instead)
- Any field not explicitly listed in the "may say" list above

**Company name:** A customer may volunteer their company name. Jane may use it to add context during the conversation but does not use it as an identity signal. Email is the sole identifier.

**Lookup tool inputs:** `lookup_customer` accepts `email` as the primary input. `company_name` is accepted as an optional supplementary field but cannot trigger a lookup on its own.

## 6. Conversation Management

**Turn limit:** 10 turns per conversation (one turn = one customer message + one Jane response).

**Time limit:** 8 minutes per conversation.

Whichever limit is reached first, Jane wraps up the call: she tells the customer she has reached the end of what she can assist with in this session, creates a ticket summarizing the conversation, escalates it, and ends the call.

**Conversation state:** Jane's memory is in-context only. The full conversation history (all prior turns) is passed to the Claude Agent SDK by the webhook server on every turn. No turn-to-turn state is persisted outside Supabase's conversation and turns tables. Each new call starts with a clean context.

**Conversation ID:** Every conversation is assigned a unique `conversation_id` (UUID) at call start by the webhook server. All turns, tool calls, retrieval logs, tickets, and escalations created during that call reference this ID. This is the primary mechanism for isolating simultaneous conversations. The ID is generated server-side before the first Vapi webhook is processed.

**Simultaneous conversations:** The system supports multiple concurrent calls. Because the webhook server is stateless and all state is keyed by `conversation_id`, there is no shared memory between conversations.

**Conversation status values:** `active`, `resolved`, `escalated`, `error`.

**Summary:** At close of every conversation, Jane generates a brief natural-language summary of what was discussed (topics raised, actions taken, outcome). This summary is stored in the conversations table and is visible in the admin dashboard.

## 7. Ticket and Escalation System

**Core rule:** Every escalation has a ticket. Not every ticket has an escalation.

**Support ticket** — created when an issue requires human follow-up but is not urgent or sensitive. Examples: a failed invoice payment that needs investigation, a question Jane could not answer from the knowledge base, a conversation that hit the clarification limit.

**Escalation** — created when the issue is urgent, sensitive, or regulated. An escalation is always linked to a ticket (ticket\_id is required). Escalation triggers:

- Account-specific issues (restrictions, closures, account status queries after lookup)
- Compliance questions
- Dispute or refund requests
- Cancellation requests
- Frustrated or distressed customer (detected via tone or explicit statement)
- Stale payout/transaction data (estimated\_arrival passed, status still processing/delayed/review required)
- Unresolved after 3 clarifying questions
- Turn limit or time limit reached

**Flow — ticket then escalation:**

1. Jane identifies that escalation is warranted
2. Jane calls `create_ticket` — receives a `ticket_id`
3. Jane calls `create_escalation` with the `ticket_id` (required), category, reason, and preferred callback time if given
4. Jane tells the customer: "I've created a support ticket and a specialist from our team will follow up with you. Is there a preferred time for a callback?"
5. Jane does not attempt further resolution after this point
6. The conversation status is set to `escalated`

**Escalation categories (maps to staff routing):**

- `account` — account-specific, restrictions, closures
- `compliance` — KYC, AML, regulatory
- `dispute` — disputed transactions
- `refund` — refund requests
- `cancellation` — service cancellation
- `frustrated_customer` — distress or frustration signals
- `unresolved` — clarification limit or turn/time limit reached
- `stale_data` — payout or transaction with a passed estimated\_arrival
- `technical_error` — backend failure during call

**Staff table and email routing:** For this version, all escalation emails route to the `customer_support` role. The staff table has one active record. Customer support is responsible for internally routing to accounts, compliance, or other teams as needed.

Escalation email contains: customer name, email, conversation ID, ticket ID, category, reason, and preferred callback time.

**What Jane says during escalation:** Jane tells the customer a specialist will follow up. She does not say she is unable to help (which sounds dismissive). She does not reveal the escalation category or any internal notes.

## 8. Knowledge Base and Retrieval

The knowledge base is the approved content Jane may draw from to answer customer queries. She is strictly grounded to it — she does not answer from general knowledge.

**Storage:** The knowledge base is chunked into sections and embedded as vectors in Supabase using the pgvector extension. Each chunk stores: the source title, the chunk text, and its embedding vector.

**Retrieval mechanism:** Semantic search. When Jane needs to answer a query, she calls the `retrieve_knowledge` MCP tool with a natural-language query. The tool performs a vector similarity search against the knowledge base embeddings and returns the top matching chunks. Jane answers only from the returned chunks.

**Retrieval as a tool:** Knowledge base retrieval is not pre-loaded into Jane's system prompt. It is a callable tool (`retrieve_knowledge`) that Jane invokes when a query requires knowledge base content. This keeps the prompt lean and makes retrieval auditable (each retrieval call is logged).

**Dynamic knowledge base:** The architecture supports knowledge base updates. When the knowledge base source document is updated, the chunks are re-embedded and the embeddings table is refreshed. The `retrieve_knowledge` tool always queries the current state of the embeddings table, so no server restart is required after a KB update.

**Retrieval logging:** Every `retrieve_knowledge` call is logged to the `retrieval_logs` table with: conversation\_id, turn number, query text, chunk IDs returned, source titles, and a short source summary. This is used for admin review and evaluation.

**Strict grounding enforcement:** If the top retrieval results have a similarity score below a defined threshold, Jane treats the query as outside the knowledge base and responds accordingly — she does not fabricate an answer from low-confidence results.

## 9. MCP Server and Tools

**Hosting:** Cloud-hosted (Railway or Render). Accessible over HTTPS only.

**Transport:** HTTP/SSE (not stdio). The Claude Agent SDK connects to the MCP server via a secure HTTP endpoint.

**Authentication:** A shared API key (set in .env) is required on all requests from the Claude Agent SDK to the MCP server. Requests without the key are rejected with 401.

**Six tools:**

**`lookup_customer`** Input: `{ email: string (required), company_name: string (optional) }` Output: `{ customer_id, name, company_name, plan, account_status, kyc_status, support_notes }` or not-found error. Note: `account_status`, `kyc_status`, and `support_notes` are for agent context only. Jane may only speak `plan` and `email` aloud (for confirmation).

**`lookup_transaction`** Input: `{ customer_id: string (required), transaction_reference: string (optional) }` Output: `{ transaction_id, reference, type, amount, currency, status, corridor, estimated_arrival, created_at }` or not-found error. Note: If `estimated_arrival` is in the past and `status` is `processing`, `delayed`, or `review required` — agent must escalate, not read the data aloud.

**`lookup_payout`** Input: `{ customer_id: string (required), payout_reference: string (optional) }` Output: `{ payout_id, reference, amount, currency, status, destination_country, estimated_arrival, created_at }` or not-found error. Note: Same stale-data rule as transactions applies.

**`retrieve_knowledge`** Input: `{ query: string (required), top_k: number (optional, default 3) }` Output: `{ chunks: [{ chunk_id, source_title, content, similarity_score }] }` Note: Jane checks similarity scores before using retrieved content. Low-confidence results are not used to answer.

**`create_ticket`** Input: `{ conversation_id: string, customer_id: string (optional), user_name: string, user_email: string, subject: string, description: string }` Output: `{ ticket_id, created_at }` Note: Always called before `create_escalation`. Returns `ticket_id` which is passed to the escalation tool.

**`create_escalation`** Input: `{ ticket_id: string (required), conversation_id: string, customer_id: string (optional), user_name: string, user_email: string, category: string, reason: string, preferred_time: string (optional) }` Output: `{ escalation_id, created_at }` Note: `ticket_id` is required (not optional). Triggers an email to the customer support staff record.

## 10. Voice Interface and Chat Widget

**Client-facing page (`/`):** A clean, minimal page aligned with RelayPay's brand (deep blue and teal on off-white, Inter font, no gradients or emojis). The page contains:

- A "Talk to Jane" button that initiates a Vapi voice call
- A live call indicator (active/inactive state)
- A chat widget panel (visible always, but changes state based on call status)
- Jane's opening context: a one-line description — "Jane is RelayPay's AI support assistant. She can help with payments, payouts, fees, and account questions."

**Voice call state (normal):** The Vapi widget handles the call UI. When a call is active, the chat widget shows any text messages Jane has pushed (e.g. transaction reference numbers, account IDs). These are one-way — the customer cannot reply in the chat widget while a call is active.

**Chat widget — Fallback state (voice fails):** If the Vapi call fails to initialize (mic permission denied, Vapi down, browser unsupported), the UI detects the failure and the chat widget converts to a message form. The customer sees: "Voice is unavailable. Leave a message and our team will get back to you." The form collects: name, email, and message. On submit, a support ticket is created directly in Supabase and a notification email is sent to customer support. Jane is not involved.

**One-way text push from Jane (during a call):** For information Jane must not speak aloud (e.g. a transaction reference number), Jane says: "I'll send that to your chat window." The webhook server pushes a formatted text card to the chat widget via a server-sent event or WebSocket. The customer sees the information as text without Jane having spoken it. The customer cannot send a reply through the widget while a call is active.

**No phone number:** Phone calling via Vapi is not implemented in this version. Web browser calls only.

## 11. Admin Dashboard

**Route:** `/admin` — protected. Admin users must log in with an email and password. Accounts are seeded manually in Supabase. No public sign-up flow.

**What the admin dashboard shows:**

- **Conversations:** All conversations listed newest first. Each row shows: conversation ID, customer email (if verified), start time, duration, status (active/resolved/escalated/error), turn count, and summary. Clicking a conversation opens a full transcript view with all turns, tool calls made, and retrieval chunks used.
- **Tickets:** All support tickets with: ticket ID, conversation ID, customer name, email, subject, status, and created date.
- **Escalations:** All escalations with: escalation ID, linked ticket ID, category, reason, preferred callback time, and created date.
- **Evaluations:** The 9 test scenario records with: scenario name, tester name, date run, expected behavior, actual behavior, and pass/fail status. Admin users mark pass/fail manually.
- **Retrieval logs:** All knowledge base retrieval calls with: conversation ID, turn number, query, source titles, similarity scores, and chunks returned.
- **Metrics:** Aggregate stats — total conversations, resolution rate (resolved / total), escalation rate (escalated / total), error rate, average turns per conversation, average call duration.
- **Costs:** Token usage per conversation and cumulative totals by model. Sourced from the turns table where token counts are logged per turn.
- **Error logs:** All conversations and turns with `status = error`, with the error message and timestamp.

## 12. Data Schema

All tables live in Supabase (PostgreSQL). The pgvector extension is enabled for the knowledge\_base table.

**Seed tables (pre-populated, not written by the agent):**

`customers` — customer\_id (uuid PK), name, email (unique), company\_name, plan, account\_status, kyc\_status, support\_notes, created\_at

`transactions` — transaction\_id (uuid PK), customer\_id (FK → customers), reference (unique), type, amount, currency, status, corridor, estimated\_arrival (timestamptz), created\_at

`payouts` — payout\_id (uuid PK), customer\_id (FK → customers), reference (unique), amount, currency, status, destination\_country, estimated\_arrival (timestamptz), created\_at

**Knowledge base table:**

`knowledge_base` — chunk\_id (uuid PK), source\_title, content (text), embedding (vector(1536)), created\_at

**Staff table:**

`staff` — staff\_id (uuid PK), name, email, role (enum: customer\_support), is\_active (boolean), created\_at

**Runtime tables (written by the system during calls):**

`conversations` — conversation\_id (uuid PK), customer\_id (FK → customers, nullable), start\_time, end\_time (nullable), status (enum: active/resolved/escalated/error), turn\_count, summary (text, nullable), created\_at

`turns` — turn\_id (uuid PK), conversation\_id (FK), turn\_number (int), role (enum: user/assistant), content (text), token\_count\_input (int), token\_count\_output (int), model\_used (text), created\_at

`tool_calls` — tool\_call\_id (uuid PK), conversation\_id (FK), turn\_id (FK), tool\_name (text), input (jsonb), output (jsonb), status (enum: success/error), created\_at

`retrieval_logs` — retrieval\_id (uuid PK), conversation\_id (FK), turn\_id (FK), query (text), chunks\_returned (jsonb), source\_titles (text\[\]), similarity\_scores (float\[\]), created\_at

`tickets` — ticket\_id (uuid PK), conversation\_id (FK), customer\_id (FK, nullable), user\_name, user\_email, subject, description, status (enum: open/closed), created\_at

`escalations` — escalation\_id (uuid PK), ticket\_id (FK, required), conversation\_id (FK), customer\_id (FK, nullable), user\_name, user\_email, category (text), reason (text), preferred\_time (text, nullable), notified\_at (timestamptz, nullable), created\_at

`evaluations` — evaluation\_id (uuid PK), scenario\_name, tester\_name, date\_run (date), expected\_behavior (text), actual\_behavior (text), result (enum: pass/fail), notes (text, nullable), created\_at

`admin_users` — admin\_id (uuid PK), email (unique), password\_hash, created\_at

## 13. Security and Configuration

**Secrets management:** All API keys and credentials are stored in `.env` files. No secrets are committed to the repository. `.env` is listed in `.gitignore`. Required environment variables:

- `ANTHROPIC_API_KEY` — Claude Agent SDK
- `VAPI_API_KEY` — Vapi voice service
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (MCP server only)
- `SUPABASE_ANON_KEY` — Supabase anon key (webhook server, read-only operations)
- `MCP_SERVER_URL` — URL of the deployed MCP server
- `MCP_API_KEY` — shared secret between webhook server and MCP server
- `ADMIN_JWT_SECRET` — secret for signing admin session tokens
- `SUPPORT_EMAIL` — email address of the customer support staff record

**Database access:** The MCP server uses the Supabase service role key for full read/write access. The webhook server uses the anon key with Row Level Security (RLS) enabled on runtime tables. RLS policies ensure the webhook server can only insert (not read or update) conversation, turn, and tool call records.

**MCP server authentication:** All requests from the Claude Agent SDK to the MCP server must include the `MCP_API_KEY` as a header. The MCP server rejects requests without it with a 401 response.

**Admin authentication:** Admin login uses email and bcrypt-hashed password stored in the `admin_users` table. On successful login, a signed JWT is issued. Protected `/admin` routes verify the JWT on every request. Sessions expire after 8 hours.

**Conversation isolation:** Every conversation is keyed by a UUID `conversation_id` generated server-side at call start. All Supabase writes during the call include this ID. The webhook server never shares state between concurrent call handlers.

**Logging failure policy:** Supabase write failures during a live call are fire-and-forget. A logging failure does not abort the call or return an error to Vapi. Failed writes are logged to the server's error console. If the primary agent SDK call fails, that is not a logging failure — it is a call failure and triggers the fallback response (Section 4).

**HTTPS:** All external communication is over HTTPS. The MCP server enforces HTTPS. The webhook server enforces HTTPS in production.

## 14. Business Hours and Timezone

**Timezone:** West African Time (WAT), UTC+1.

**Business hours:** Monday to Friday, 09:00 – 17:00 WAT. No weekend support.

**During business hours:** Jane handles calls normally. If an escalation is created, the email is sent immediately and a callback can be scheduled for any slot within the same business day or the next available business day.

**Outside business hours (evenings, weekends):** Jane still answers calls and handles all queries she can resolve from the knowledge base. For queries requiring a callback or specialist follow-up, Jane explains that the support team is currently unavailable but will follow up when they are next available (next business day, 09:00 WAT). The escalation is still created and the email is still sent — the team will action it when they return. Jane does not promise a callback time outside business hours unless the customer specifies a future slot that falls within business hours.

**Callback time handling:** When a customer gives a preferred callback time, Jane records it in the `preferred_time` field of the escalation record as a plain-text string (e.g. "tomorrow at 9am"). The system does not validate or convert this to a timestamp — that is the support team's responsibility. If the customer is clearly outside WAT (e.g. mentions a time that implies a different timezone), Jane notes this in the `reason` field of the escalation.

## 15. Model Selection Strategy

**Principle:** Use the cheapest model that reliably achieves good results for each task. Do not over-provision.

| Task | Recommended model | Reason |
| --- | --- | --- |
| Main conversational agent (Jane) | claude-sonnet-4-6 | Requires strong instruction following, tool use, and grounding judgment across a multi-turn voice conversation |
| Knowledge base embedding (at index time) | text-embedding-3-small (OpenAI) or equivalent | Low cost, high throughput, 1536 dimensions for pgvector |
| Knowledge base retrieval similarity | pgvector cosine similarity | No model call needed — handled in Supabase |
| Admin dashboard — evaluation judge | Human (manual) | Out of scope for this version |

**Token logging:** Every turn logs `token_count_input`, `token_count_output`, and `model_used` to the turns table. The admin dashboard aggregates these into a cost estimate using current model pricing.

**Model upgrades:** If Jane's response quality is insufficient with claude-sonnet-4-6 in testing, the model field is easily switched to claude-sonnet-5-5 or claude-opus-5-5 without architectural changes. The `model_used` column in turns makes it straightforward to A/B compare costs and quality across model versions.

## 16. Testing and Evaluation

**Method:** 9 full voice calls conducted by human testers using the deployed web interface.

**Seed data:** Testers use the exact names, emails, and references from the seed data (e.g. "Amara from LagosLedger", using Amara's seeded email address). This is intentional for this version — the system is not expected to handle arbitrary inputs outside the seed data in the evaluation phase.

**Database:** Testing runs against the same Supabase instance as development. Test conversations are distinguishable by the tester name recorded in the evaluations table.

**Evaluation process:**

1. Tester conducts a voice call following the scenario script from the test-scenarios document
2. After the call, the tester reviews the conversation transcript in the admin dashboard
3. Tester navigates to the Evaluations section and creates a record with: scenario name, their name, date, expected behavior (from the scenario doc), actual behavior (what Jane said and did), and pass/fail result
4. Notes field captures any edge case observations

**Pass criteria (per scenario):**

- Jane used the correct decision path (answer / clarify / lookup / escalate)
- Jane's response was grounded strictly in the knowledge base where applicable
- For lookup scenarios: correct data was retrieved and only permitted fields were spoken
- For escalation scenarios: a ticket was created first, then an escalation; the correct category was used
- For decline scenarios: Jane declined appropriately without fabricating an answer

**The 9 scenarios cover:**

1. General knowledge query (fees)
2. Out-of-scope query (Jane declines)
3. Customer lookup + identity verification
4. Transaction status lookup (non-stale)
5. Payout lookup (non-stale)
6. Ticket creation (no escalation)
7. Escalation trigger (frustrated customer)
8. Callback scheduling request (after-hours)
9. Stale data handling (escalate instead of reading)

## 17. Deliverables and Submission Checklist

- [ ] Deployed web application with public client interface at `/` and protected admin dashboard at `/admin`
- [ ] Voice agent (Jane) accessible via Vapi on the client interface, with chat widget fallback
- [ ] MCP server deployed to cloud, accessible over HTTPS, with all 6 tools implemented
- [ ] MCP server repository link (public GitHub repo)
- [ ] Supabase project with all tables seeded and pgvector knowledge base populated
- [ ] Admin dashboard showing conversations, tickets, escalations, evaluations, retrieval logs, metrics, costs, and error logs
- [ ] 9 test scenarios completed by human testers; evaluation records populated in Supabase
- [ ] Evidence of all 9 test scenarios (screenshots or screen recording of admin dashboard showing conversation transcripts and evaluation results)
- [ ] Loom video walkthrough demonstrating: a full voice call with Jane, the admin dashboard, a ticket and escalation being created, and the chat widget fallback
- [ ] Reflection sheet (per cohort submission requirements)
- [ ] One-page explainer document describing the system architecture and key design decisions
