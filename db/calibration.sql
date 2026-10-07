-- Daily Calibration cloud backup (optional). Run once in Supabase → SQL Editor.
-- One flexible table: each row is a trial or a session, stored whole as JSON,
-- so adding new trial fields never needs a migration. Only you can read/write
-- your own rows.

create table if not exists public.cal_rows (
  id          text primary key,              -- trial "sessionId:gi" or session id
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,                 -- 'trial' | 'session'
  session_id  text,
  at          timestamptz not null default now(),
  data        jsonb not null
);
create index if not exists cal_rows_user_at on public.cal_rows (user_id, at);

alter table public.cal_rows enable row level security;
drop policy if exists "own cal read"   on public.cal_rows;
drop policy if exists "own cal insert" on public.cal_rows;
drop policy if exists "own cal update" on public.cal_rows;
create policy "own cal read"   on public.cal_rows for select using (auth.uid() = user_id);
create policy "own cal insert" on public.cal_rows for insert with check (auth.uid() = user_id);
create policy "own cal update" on public.cal_rows for update using (auth.uid() = user_id);
