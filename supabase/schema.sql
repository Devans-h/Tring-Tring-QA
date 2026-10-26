-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- One row per problem (key = "<section>-<id>", e.g. "telenow-4").

create table if not exists public.problem_state (
  key            text primary key,
  remark         text not null default '',
  remark_updated timestamptz,
  done           boolean not null default false,
  done_updated   timestamptz
);

-- The page uses the public anon key, so allow it to read and write this table.
alter table public.problem_state enable row level security;

drop policy if exists "problem_state read"   on public.problem_state;
drop policy if exists "problem_state insert" on public.problem_state;
drop policy if exists "problem_state update" on public.problem_state;

create policy "problem_state read"   on public.problem_state for select to anon using (true);
create policy "problem_state insert" on public.problem_state for insert to anon with check (true);
create policy "problem_state update" on public.problem_state for update to anon using (true) with check (true);

-- Live updates: when one developer saves, everyone else's page updates by itself.
alter publication supabase_realtime add table public.problem_state;
