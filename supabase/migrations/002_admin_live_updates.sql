-- Live admin dashboard via Supabase Realtime (Broadcast from the database).
-- On every insert/update/delete in the logged tables, a trigger broadcasts a
-- tiny signal ({ table, type }) on the "admin-dashboard" channel. Open admin
-- pages receive it over Realtime's WebSocket and re-fetch through the
-- protected admin API. No row data is broadcast, and no table is made
-- readable with the public anon key.
-- Re-running this file is safe.

create schema if not exists private;

create or replace function private.broadcast_admin_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('table', tg_table_name, 'type', tg_op),
    'change',           -- event
    'admin-dashboard',  -- channel (topic)
    false               -- public channel: the payload carries no customer data
  );
  return null;
end;
$$;

revoke all on function private.broadcast_admin_change() from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['conversations', 'turns', 'tool_calls', 'retrieval_logs', 'tickets', 'escalations', 'conversation_events', 'evaluations'] loop
    execute format('drop trigger if exists admin_dashboard_notify on public.%I', t);
    execute format('drop trigger if exists admin_dashboard_broadcast on public.%I', t);
    execute format(
      'create trigger admin_dashboard_broadcast after insert or update or delete on public.%I
         for each row execute function private.broadcast_admin_change()', t);
  end loop;
end;
$$;

drop function if exists private.notify_admin_dashboard();
