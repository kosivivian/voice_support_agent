-- Caller verification by one-time code sent to the email on file.
-- Codes are stored as an HMAC, never in plain text. Only the MCP server
-- (service role) can read or write them: RLS is on with no anon policies.

create table if not exists verification_codes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(conversation_id),
  customer_id     text references customers(customer_id),
  email           text not null,
  code_hash       text not null,
  expires_at      timestamptz not null,
  attempts        int not null default 0,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists verification_codes_conversation_idx on verification_codes (conversation_id, created_at desc);
create index if not exists verification_codes_email_idx on verification_codes (email, created_at desc);

alter table verification_codes enable row level security;

-- Which customer this call has proven it owns. Set only by verify_code.
alter table conversations add column if not exists verified_customer_id text references customers(customer_id);
alter table conversations add column if not exists verified_at timestamptz;
