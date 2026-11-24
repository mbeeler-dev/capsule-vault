-- Capsule Vault database setup.
-- Run this once in Supabase: dashboard > SQL Editor > New query > paste > Run.
--
-- Row Level Security (RLS) is what keeps people's data apart. The browser talks to
-- the database directly, so these rules are the real security, not the app's buttons.

-- 1. Each person's private vault: one row per user holding their whole collection as JSON.
create table if not exists public.vaults (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.vaults enable row level security;

drop policy if exists "read own vault" on public.vaults;
create policy "read own vault" on public.vaults
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "create own vault" on public.vaults;
create policy "create own vault" on public.vaults
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own vault" on public.vaults;
create policy "update own vault" on public.vaults
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own vault" on public.vaults;
create policy "delete own vault" on public.vaults
  for delete to authenticated using (auth.uid() = user_id);

-- 2. Public showcases: a filtered copy of someone's shelf (no prices paid, notes or wishlist).
--    Anyone can read them; only the owner can create, change or delete theirs.
create table if not exists public.showcases (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.showcases enable row level security;

drop policy if exists "anyone can view showcases" on public.showcases;
create policy "anyone can view showcases" on public.showcases
  for select to anon, authenticated using (true);

drop policy if exists "publish own showcase" on public.showcases;
create policy "publish own showcase" on public.showcases
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own showcase" on public.showcases;
create policy "update own showcase" on public.showcases
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "take down own showcase" on public.showcases;
create policy "take down own showcase" on public.showcases
  for delete to authenticated using (auth.uid() = user_id);

-- Table-level access for the website's API roles. RLS above still decides WHICH rows each person can touch.
grant select, insert, update, delete on public.vaults to authenticated;
grant select on public.showcases to anon, authenticated;
grant insert, update, delete on public.showcases to authenticated;

-- 3. Photo storage: a public bucket (so showcase photos load for visitors), images only, 5 MB max.
--    Each user may only add or delete files inside their own folder: photos/<their user id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload to own photo folder" on storage.objects;
create policy "upload to own photo folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delete from own photo folder" on storage.objects;
create policy "delete from own photo folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
