-- Contour Canvas: Supabase Multiplayer (allow-all / no-auth)
-- Run this in Supabase SQL editor.

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

-- Simple updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) computers
create table if not exists public.computers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text,
  timezone text,
  client_fingerprint text
);

create index if not exists computers_last_seen_at_idx on public.computers (last_seen_at);

-- 2) sessions
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('waiting', 'active', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  player1_computer_id uuid references public.computers (id),
  player2_computer_id uuid references public.computers (id),
  started_at timestamptz,
  ended_at timestamptz
);

create index if not exists sessions_status_created_at_idx on public.sessions (status, created_at);
create index if not exists sessions_player1_idx on public.sessions (player1_computer_id);
create index if not exists sessions_player2_idx on public.sessions (player2_computer_id);

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
before update on public.sessions
for each row execute function public.set_updated_at();

-- 3) session_state (last 5 events)
create table if not exists public.session_state (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  updated_at timestamptz not null default now(),
  last5_events jsonb not null default '[]'::jsonb
);

drop trigger if exists session_state_set_updated_at on public.session_state;
create trigger session_state_set_updated_at
before update on public.session_state
for each row execute function public.set_updated_at();

-- 4) allow-all RLS + grants
alter table public.computers enable row level security;
alter table public.sessions enable row level security;
alter table public.session_state enable row level security;

drop policy if exists computers_allow_all_select on public.computers;
drop policy if exists computers_allow_all_insert on public.computers;
drop policy if exists computers_allow_all_update on public.computers;
drop policy if exists computers_allow_all_delete on public.computers;

create policy computers_allow_all_select on public.computers for select to anon, authenticated using (true);
create policy computers_allow_all_insert on public.computers for insert to anon, authenticated with check (true);
create policy computers_allow_all_update on public.computers for update to anon, authenticated using (true) with check (true);
create policy computers_allow_all_delete on public.computers for delete to anon, authenticated using (true);

drop policy if exists sessions_allow_all_select on public.sessions;
drop policy if exists sessions_allow_all_insert on public.sessions;
drop policy if exists sessions_allow_all_update on public.sessions;
drop policy if exists sessions_allow_all_delete on public.sessions;

create policy sessions_allow_all_select on public.sessions for select to anon, authenticated using (true);
create policy sessions_allow_all_insert on public.sessions for insert to anon, authenticated with check (true);
create policy sessions_allow_all_update on public.sessions for update to anon, authenticated using (true) with check (true);
create policy sessions_allow_all_delete on public.sessions for delete to anon, authenticated using (true);

drop policy if exists session_state_allow_all_select on public.session_state;
drop policy if exists session_state_allow_all_insert on public.session_state;
drop policy if exists session_state_allow_all_update on public.session_state;
drop policy if exists session_state_allow_all_delete on public.session_state;

create policy session_state_allow_all_select on public.session_state for select to anon, authenticated using (true);
create policy session_state_allow_all_insert on public.session_state for insert to anon, authenticated with check (true);
create policy session_state_allow_all_update on public.session_state for update to anon, authenticated using (true) with check (true);
create policy session_state_allow_all_delete on public.session_state for delete to anon, authenticated using (true);

grant select, insert, update, delete on public.computers to anon, authenticated;
grant select, insert, update, delete on public.sessions to anon, authenticated;
grant select, insert, update, delete on public.session_state to anon, authenticated;

-- 5) enable realtime on tables
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.session_state;

-- 6) RPCs
create or replace function public.touch_computer(
  p_computer_id uuid,
  p_user_agent text,
  p_timezone text,
  p_fingerprint text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.computers (id, user_agent, timezone, client_fingerprint, last_seen_at)
  values (p_computer_id, p_user_agent, p_timezone, p_fingerprint, now())
  on conflict (id) do update set
    user_agent = excluded.user_agent,
    timezone = excluded.timezone,
    client_fingerprint = excluded.client_fingerprint,
    last_seen_at = now();
end;
$$;

grant execute on function public.touch_computer(uuid, text, text, text) to anon, authenticated;

create or replace function public.matchmake(p_computer_id uuid)
returns table (session_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  -- Ensure computer exists (best-effort)
  insert into public.computers (id, last_seen_at) values (p_computer_id, now())
  on conflict (id) do update set last_seen_at = now();

  -- Try to claim an existing waiting session
  select s.id
    into v_session_id
  from public.sessions s
  where s.status = 'waiting'
    and s.player2_computer_id is null
  order by s.created_at asc
  for update skip locked
  limit 1;

  if v_session_id is not null then
    update public.sessions
      set player2_computer_id = p_computer_id,
          status = 'active',
          started_at = coalesce(started_at, now())
      where id = v_session_id;

    insert into public.session_state (session_id) values (v_session_id)
    on conflict (session_id) do nothing;

    session_id := v_session_id;
    role := 'player2';
    return next;
    return;
  end if;

  -- Otherwise, create a new waiting session
  insert into public.sessions (status, player1_computer_id)
  values ('waiting', p_computer_id)
  returning id into v_session_id;

  insert into public.session_state (session_id) values (v_session_id)
  on conflict (session_id) do nothing;

  session_id := v_session_id;
  role := 'player1';
  return next;
  return;
end;
$$;

grant execute on function public.matchmake(uuid) to anon, authenticated;
