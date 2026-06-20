-- Persist each player's round results in Supabase (no-auth / allow-all)
-- Run this after `001_multiplayer.sql`.

create table if not exists public.session_rounds (
  session_id uuid not null references public.sessions (id) on delete cascade,
  round int not null check (round >= 1),
  computer_id uuid not null references public.computers (id) on delete cascade,
  prompt_id text not null,
  score numeric not null default 0,
  drawing_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, round, computer_id)
);

create index if not exists session_rounds_session_round_idx on public.session_rounds (session_id, round);
create index if not exists session_rounds_session_computer_idx on public.session_rounds (session_id, computer_id);

drop trigger if exists session_rounds_set_updated_at on public.session_rounds;
create trigger session_rounds_set_updated_at
before update on public.session_rounds
for each row execute function public.set_updated_at();

alter table public.session_rounds enable row level security;

drop policy if exists session_rounds_allow_all_select on public.session_rounds;
drop policy if exists session_rounds_allow_all_insert on public.session_rounds;
drop policy if exists session_rounds_allow_all_update on public.session_rounds;
drop policy if exists session_rounds_allow_all_delete on public.session_rounds;

create policy session_rounds_allow_all_select on public.session_rounds for select to anon, authenticated using (true);
create policy session_rounds_allow_all_insert on public.session_rounds for insert to anon, authenticated with check (true);
create policy session_rounds_allow_all_update on public.session_rounds for update to anon, authenticated using (true) with check (true);
create policy session_rounds_allow_all_delete on public.session_rounds for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.session_rounds to anon, authenticated;

-- Enable realtime on this table (optional but useful for live leaderboard/round sync)
alter publication supabase_realtime add table public.session_rounds;

