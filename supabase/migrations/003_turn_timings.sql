-- Per-turn latency breakdown written by the webhook server (time to first word,
-- each model pass, each tool call). Until this runs, turns are saved without it.
alter table turns add column if not exists timings jsonb;
