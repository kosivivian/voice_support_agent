-- RelayPay Support Agent (Jane) — full schema.
-- Run once in the Supabase SQL editor (or `supabase db push`).
-- Seed tables follow the shape of assets/seed-data/*.csv.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type conversation_status as enum ('active', 'resolved', 'escalated', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type turn_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type call_status as enum ('success', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_status as enum ('open', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type escalation_status as enum ('open', 'in_progress', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type staff_role as enum ('customer_support');
exception when duplicate_object then null; end $$;

do $$ begin
  create type eval_result as enum ('pass', 'fail');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Seed tables (pre-populated from CSV, never written by the agent)
-- ---------------------------------------------------------------------------
create table if not exists customers (
  customer_id    text primary key,              -- e.g. CUS-1001
  company_name   text not null,
  contact_name   text not null,
  contact_email  text not null unique,
  plan           text not null,                 -- Starter | Growth | Scale
  account_status text not null,                 -- active | restricted | pending verification
  region         text,
  kyc_status     text not null,                 -- pending | approved | review required
  support_notes  text,                          -- agent context only, never spoken
  created_at     timestamptz not null default now()
);

create table if not exists transactions (
  transaction_id      text primary key,         -- e.g. TXN-9001 (also the customer-facing reference)
  customer_id         text not null references customers(customer_id),
  transaction_type    text not null,            -- incoming transfer | outgoing payout | invoice payment
  amount              numeric(14,2) not null,
  currency            text not null,
  destination_country text,
  status              text not null,            -- processing | completed | delayed | failed | review required
  created_at          timestamptz not null,
  estimated_arrival   date,
  support_summary     text                      -- customer-safe status summary
);

create table if not exists payouts (
  payout_id      text primary key,              -- e.g. PAY-7001
  transaction_id text references transactions(transaction_id),
  customer_id    text not null references customers(customer_id),
  recipient_name text,
  amount         numeric(14,2) not null,
  currency       text not null,
  status         text not null,                 -- scheduled | processing | completed | failed | review required
  scheduled_for  date,                          -- used as the payout's estimated arrival for the stale-data rule
  failure_reason text,                          -- customer-safe reason if failed
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Knowledge base (Voyage voyage-3.5-lite, 1024 dims)
-- ---------------------------------------------------------------------------
create table if not exists knowledge_base (
  chunk_id     uuid primary key default gen_random_uuid(),
  source_title text not null,
  content      text not null,
  embedding    vector(1024) not null,
  created_at   timestamptz not null default now()
);

create or replace function match_knowledge(query_embedding vector(1024), match_count int default 3)
returns table (chunk_id uuid, source_title text, content text, similarity float)
language sql stable
as $$
  select kb.chunk_id, kb.source_title, kb.content,
         1 - (kb.embedding <=> query_embedding) as similarity
  from knowledge_base kb
  order by kb.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table if not exists staff (
  staff_id   uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  role       staff_role not null default 'customer_support',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Runtime tables
-- ---------------------------------------------------------------------------
create table if not exists conversations (
  conversation_id uuid primary key,             -- derived server-side from the Vapi call id (uuid v5)
  vapi_call_id    text unique,
  channel         text not null default 'voice',
  customer_id     text references customers(customer_id),
  customer_email  text,                         -- set once lookup_customer finds a record
  start_time      timestamptz not null default now(),
  end_time        timestamptz,
  status          conversation_status not null default 'active',
  turn_count      int not null default 0,
  summary         text,
  error_message   text,
  ended_reason    text,
  created_at      timestamptz not null default now()
);

create table if not exists turns (
  turn_id            uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references conversations(conversation_id) on delete cascade,
  turn_number        int not null,
  role               turn_role not null,
  content            text not null,
  answer_type        text,                      -- answer | clarify | lookup | escalate | decline | ticket | greeting | wrap_up | fallback
  status             call_status not null default 'success',
  error_message      text,
  token_count_input  int,
  token_count_output int,
  cache_read_tokens  int,
  cache_write_tokens int,
  cost_usd           numeric(12,6),
  latency_ms         int,
  model_used         text,
  created_at         timestamptz not null default now()
);
create index if not exists turns_conversation_idx on turns(conversation_id, turn_number);

create table if not exists tool_calls (
  tool_call_id    uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(conversation_id) on delete cascade,
  turn_id         uuid,                         -- id of the user turn that triggered the call (no FK: turn row is written async)
  turn_number     int,
  tool_name       text not null,
  input           jsonb,
  output          jsonb,
  status          call_status not null,
  error_message   text,
  duration_ms     int,
  created_at      timestamptz not null default now()
);
create index if not exists tool_calls_conversation_idx on tool_calls(conversation_id);

create table if not exists retrieval_logs (
  retrieval_id      uuid primary key default gen_random_uuid(),
  conversation_id   uuid references conversations(conversation_id) on delete cascade,
  turn_id           uuid,
  turn_number       int,
  query             text not null,
  chunks_returned   jsonb not null,
  source_titles     text[] not null,
  similarity_scores float8[] not null,
  source_summary    text,
  above_threshold   boolean not null,
  created_at        timestamptz not null default now()
);

create table if not exists tickets (
  ticket_id       uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(conversation_id),  -- null for chat-fallback tickets
  customer_id     text references customers(customer_id),
  source          text not null default 'voice',                    -- voice | chat_fallback
  user_name       text not null,
  user_email      text not null,
  subject         text not null,
  description     text not null,
  category        text,
  priority        text not null default 'normal',                   -- low | normal | high | urgent
  status          ticket_status not null default 'open',
  created_at      timestamptz not null default now()
);

create table if not exists escalations (
  escalation_id   uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references tickets(ticket_id),
  conversation_id uuid references conversations(conversation_id),
  customer_id     text references customers(customer_id),
  user_name       text not null,
  user_email      text not null,
  category        text not null check (category in (
                    'account','compliance','dispute','refund','cancellation',
                    'frustrated_customer','unresolved','stale_data','technical_error')),
  reason          text not null,
  preferred_time  text,
  call_booked     boolean not null default false,
  status          escalation_status not null default 'open',
  notified_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists conversation_events (
  event_id        uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(conversation_id) on delete cascade,
  turn_number     int,
  event_type      text not null,
  summary         text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists evaluations (
  evaluation_id     uuid primary key default gen_random_uuid(),
  scenario_number   int,
  scenario_name     text not null,
  tester_name       text,
  date_run          date,
  conversation_id   uuid references conversations(conversation_id),
  expected_behavior text not null,
  actual_behavior   text,
  result            eval_result,               -- null until a tester marks it
  notes             text,
  created_at        timestamptz not null default now()
);

create table if not exists admin_users (
  admin_id      uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The service role bypasses RLS (MCP server + admin API).
-- The anon key (webhook call handlers) may only INSERT runtime records.
-- ---------------------------------------------------------------------------
alter table customers           enable row level security;
alter table transactions        enable row level security;
alter table payouts             enable row level security;
alter table knowledge_base      enable row level security;
alter table staff               enable row level security;
alter table conversations       enable row level security;
alter table turns               enable row level security;
alter table tool_calls          enable row level security;
alter table retrieval_logs      enable row level security;
alter table tickets             enable row level security;
alter table escalations         enable row level security;
alter table conversation_events enable row level security;
alter table evaluations         enable row level security;
alter table admin_users         enable row level security;

drop policy if exists anon_insert_turns on turns;
create policy anon_insert_turns on turns for insert to anon with check (true);

drop policy if exists anon_insert_tool_calls on tool_calls;
create policy anon_insert_tool_calls on tool_calls for insert to anon with check (true);

drop policy if exists anon_insert_fallback_tickets on tickets;
create policy anon_insert_fallback_tickets on tickets for insert to anon
  with check (source = 'chat_fallback' and conversation_id is null);

-- Conversations are created/finalised by the anon client only through the narrow
-- SECURITY DEFINER functions below, never through direct table access.
create or replace function start_conversation(p_conversation_id uuid, p_vapi_call_id text, p_start_time timestamptz default now())
returns void
language sql security definer set search_path = public
as $$
  insert into conversations (conversation_id, vapi_call_id, start_time)
  values (p_conversation_id, p_vapi_call_id, coalesce(p_start_time, now()))
  on conflict (conversation_id) do nothing;
$$;

create or replace function record_turn_count(p_conversation_id uuid, p_turn_count int)
returns void
language sql security definer set search_path = public
as $$
  update conversations set turn_count = greatest(turn_count, p_turn_count)
  where conversation_id = p_conversation_id;
$$;

create or replace function mark_conversation_error(p_conversation_id uuid, p_error text)
returns void
language sql security definer set search_path = public
as $$
  update conversations
  set status = case when status = 'escalated' then status else 'error' end,
      error_message = p_error
  where conversation_id = p_conversation_id;
$$;

-- Final status: escalated/error are sticky; otherwise the call counts as resolved.
create or replace function finalize_conversation(
  p_conversation_id uuid, p_summary text, p_end_time timestamptz, p_ended_reason text, p_turn_count int)
returns void
language sql security definer set search_path = public
as $$
  update conversations
  set summary      = p_summary,
      end_time     = coalesce(p_end_time, now()),
      ended_reason = p_ended_reason,
      turn_count   = greatest(turn_count, coalesce(p_turn_count, 0)),
      status       = case when status in ('escalated', 'error') then status else 'resolved' end
  where conversation_id = p_conversation_id;
$$;

revoke all on function start_conversation(uuid, text, timestamptz) from public;
revoke all on function record_turn_count(uuid, int) from public;
revoke all on function mark_conversation_error(uuid, text) from public;
revoke all on function finalize_conversation(uuid, text, timestamptz, text, int) from public;
grant execute on function start_conversation(uuid, text, timestamptz) to anon, service_role;
grant execute on function record_turn_count(uuid, int) to anon, service_role;
grant execute on function mark_conversation_error(uuid, text) to anon, service_role;
grant execute on function finalize_conversation(uuid, text, timestamptz, text, int) to anon, service_role;
