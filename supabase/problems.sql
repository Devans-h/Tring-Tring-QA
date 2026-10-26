-- Lets the page add problems itself (the "+ Add problem" button).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again.

create extension if not exists pgcrypto;

-- One row per problem added from the page. Problems in data.js are not stored here.
create table if not exists public.problems (
  id               uuid primary key default gen_random_uuid(),
  section_key      text not null,
  section_title    text,
  section_subtitle text,
  num              integer not null,
  title            text not null,
  problem          text not null default '',
  expectation      text not null default '',
  proof            jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

alter table public.problems enable row level security;

drop policy if exists "problems read"   on public.problems;
drop policy if exists "problems insert" on public.problems;
drop policy if exists "problems update" on public.problems;
drop policy if exists "problems delete" on public.problems;

create policy "problems read"   on public.problems for select to anon using (true);
create policy "problems insert" on public.problems for insert to anon with check (true);
create policy "problems update" on public.problems for update to anon using (true) with check (true);
create policy "problems delete" on public.problems for delete to anon using (true);

-- Live updates: a problem added on one screen appears on everyone else's.
do $$
begin
  alter publication supabase_realtime add table public.problems;
exception when duplicate_object then null;
end $$;

-- Public bucket for recordings and screenshots uploaded from the page.
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', true)
on conflict (id) do update set public = true;

drop policy if exists "proofs public read" on storage.objects;
drop policy if exists "proofs anon upload" on storage.objects;
drop policy if exists "proofs anon delete" on storage.objects;

create policy "proofs public read" on storage.objects for select to public using (bucket_id = 'proofs');
create policy "proofs anon upload" on storage.objects for insert to anon with check (bucket_id = 'proofs');
create policy "proofs anon delete" on storage.objects for delete to anon using (bucket_id = 'proofs');
