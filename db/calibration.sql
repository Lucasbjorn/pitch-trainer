-- Lucas's AP Training Hub — account-based sync (phone ↔ laptop).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- One flexible table: each row is a trial or a session, stored whole as JSON,
-- so new trial fields never need a migration. Row-level security: only the
-- signed-in owner can read or write their rows. updated_at is set by the
-- SERVER on every insert/update, so each device can ask "what changed since I
-- last synced?" without trusting device clocks.

create table if not exists public.cal_rows (
  id          text primary key,              -- trial "sessionId:gi" or session id
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,                 -- 'trial' | 'session'
  session_id  text,
  at          timestamptz not null default now(),   -- when it happened (device time)
  data        jsonb not null,
  updated_at  timestamptz not null default now()    -- when the server last saw it
);
alter table public.cal_rows add column if not exists updated_at timestamptz not null default now();

create or replace function public.cal_rows_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists cal_rows_touch on public.cal_rows;
create trigger cal_rows_touch before insert or update on public.cal_rows
  for each row execute function public.cal_rows_touch();

create index if not exists cal_rows_user_at on public.cal_rows (user_id, at);
create index if not exists cal_rows_user_updated on public.cal_rows (user_id, updated_at);

alter table public.cal_rows enable row level security;
drop policy if exists "own cal read"   on public.cal_rows;
drop policy if exists "own cal insert" on public.cal_rows;
drop policy if exists "own cal update" on public.cal_rows;
create policy "own cal read"   on public.cal_rows for select using (auth.uid() = user_id);
create policy "own cal insert" on public.cal_rows for insert with check (auth.uid() = user_id);
create policy "own cal update" on public.cal_rows for update using (auth.uid() = user_id);
