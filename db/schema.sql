-- Ear Games — Supabase schema. Paste into Supabase → SQL Editor → Run.

-- Profiles: one row per user, publicly readable (leaderboard names/pics).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_url text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles readable by all" on public.profiles;
create policy "profiles readable by all" on public.profiles for select using (true);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Daily scores: one per (user, game, date). Lower score = better (cents).
create table if not exists public.scores (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_id text not null,
  date date not null,
  score numeric not null,
  label text,
  created_at timestamptz default now(),
  primary key (user_id, game_id, date)
);
alter table public.scores enable row level security;
drop policy if exists "scores readable by all" on public.scores;
create policy "scores readable by all" on public.scores for select using (true);
drop policy if exists "own score insert" on public.scores;
create policy "own score insert" on public.scores for insert with check (auth.uid() = user_id);
drop policy if exists "own score update" on public.scores;
create policy "own score update" on public.scores for update using (auth.uid() = user_id);

-- Avatars storage bucket (public read, authenticated write).
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do nothing;
drop policy if exists "avatars readable" on storage.objects;
create policy "avatars readable" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars write" on storage.objects;
create policy "avatars write" on storage.objects for insert with check (bucket_id = 'avatars' and auth.role() = 'authenticated');
drop policy if exists "avatars update" on storage.objects;
create policy "avatars update" on storage.objects for update using (bucket_id = 'avatars' and auth.role() = 'authenticated');
