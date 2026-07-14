-- Ear Games — social layer (feed, comments, DMs). Run AFTER schema.sql.

-- Text posts for the feed.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
alter table public.posts enable row level security;
drop policy if exists "posts readable" on public.posts;
create policy "posts readable" on public.posts for select using (true);
drop policy if exists "own post insert" on public.posts;
create policy "own post insert" on public.posts for insert with check (auth.uid() = user_id);
drop policy if exists "own post delete" on public.posts;
create policy "own post delete" on public.posts for delete using (auth.uid() = user_id);

-- Comments on a score or a post (target_type + target_id).
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,   -- 'score' | 'post'
  target_id text not null,     -- score: "gameId:date:userId"  |  post: post uuid
  body text not null,
  created_at timestamptz default now()
);
alter table public.comments enable row level security;
drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments for select using (true);
drop policy if exists "own comment insert" on public.comments;
create policy "own comment insert" on public.comments for insert with check (auth.uid() = user_id);
drop policy if exists "own comment delete" on public.comments;
create policy "own comment delete" on public.comments for delete using (auth.uid() = user_id);

-- Direct messages (only sender/recipient can read).
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);
alter table public.messages enable row level security;
drop policy if exists "dm readable" on public.messages;
create policy "dm readable" on public.messages for select using (auth.uid() = sender or auth.uid() = recipient);
drop policy if exists "dm send" on public.messages;
create policy "dm send" on public.messages for insert with check (auth.uid() = sender);

-- Live updates for the feed / DMs.
alter publication supabase_realtime add table public.scores, public.posts, public.comments, public.messages;
