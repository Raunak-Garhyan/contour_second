-- Fix matchmake so players already in an active game are not pulled into
-- another lobby, stale waiting rooms are skipped, and reconnecting players
-- return to their existing session instead of creating duplicates.

create or replace function public.matchmake(p_computer_id uuid)
returns table (session_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_role text;
begin
  insert into public.computers (id, last_seen_at)
  values (p_computer_id, now())
  on conflict (id) do update set last_seen_at = now();

  -- Reconnect to an in-progress game for this computer.
  select s.id
    into v_session_id
  from public.sessions s
  where s.status = 'active'
    and (s.player1_computer_id = p_computer_id or s.player2_computer_id = p_computer_id)
  order by coalesce(s.started_at, s.created_at) desc
  for update skip locked
  limit 1;

  if v_session_id is not null then
    select case
      when s.player1_computer_id = p_computer_id then 'player1'
      else 'player2'
    end
      into v_role
    from public.sessions s
    where s.id = v_session_id;

    session_id := v_session_id;
    role := v_role;
    return next;
    return;
  end if;

  -- Reconnect to an open lobby this computer already hosts.
  select s.id
    into v_session_id
  from public.sessions s
  where s.status = 'waiting'
    and s.player1_computer_id = p_computer_id
    and s.player2_computer_id is null
  order by s.created_at desc
  for update skip locked
  limit 1;

  if v_session_id is not null then
    session_id := v_session_id;
    role := 'player1';
    return next;
    return;
  end if;

  -- Join the oldest open lobby whose host is not busy in another active game.
  select s.id
    into v_session_id
  from public.sessions s
  where s.status = 'waiting'
    and s.player2_computer_id is null
    and s.player1_computer_id is distinct from p_computer_id
    and not exists (
      select 1
      from public.sessions busy
      where busy.status = 'active'
        and (
          busy.player1_computer_id = s.player1_computer_id
          or busy.player2_computer_id = s.player1_computer_id
        )
        and busy.id <> s.id
    )
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

  -- No suitable lobby: create a new waiting room.
  insert into public.sessions (status, player1_computer_id)
  values ('waiting', p_computer_id)
  returning id into v_session_id;

  insert into public.session_state (session_id) values (v_session_id)
  on conflict on constraint session_state_pkey do nothing;

  session_id := v_session_id;
  role := 'player1';
  return next;
end;
$$;

grant execute on function public.matchmake(uuid) to anon, authenticated;
