-- Fix: avoid ambiguous `session_id` reference in public.matchmake() by using
-- `ON CONFLICT ON CONSTRAINT session_state_pkey` (does not mention session_id).
--
-- Run this after `001_multiplayer.sql`. If you already ran `002_*`, you can
-- skip this (both migrations apply the same functional fix).

create or replace function public.matchmake(p_computer_id uuid)
returns table (session_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  insert into public.computers (id, last_seen_at) values (p_computer_id, now())
  on conflict (id) do update set last_seen_at = now();

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
    on conflict on constraint session_state_pkey do nothing;

    session_id := v_session_id;
    role := 'player2';
    return next;
    return;
  end if;

  insert into public.sessions (status, player1_computer_id)
  values ('waiting', p_computer_id)
  returning id into v_session_id;

  insert into public.session_state (session_id) values (v_session_id)
  on conflict on constraint session_state_pkey do nothing;

  session_id := v_session_id;
  role := 'player1';
  return next;
  return;
end;
$$;

grant execute on function public.matchmake(uuid) to anon, authenticated;

