-- Invite-only multiplayer: create a lobby without auto-joining strangers.
-- Run after 001_multiplayer.sql.

create or replace function public.create_lobby(p_computer_id uuid)
returns table (session_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  insert into public.computers (id, last_seen_at)
  values (p_computer_id, now())
  on conflict (id) do update set last_seen_at = now();

  -- Reconnect to an in-progress game.
  select s.id
    into v_session_id
  from public.sessions s
  where s.status = 'active'
    and (s.player1_computer_id = p_computer_id or s.player2_computer_id = p_computer_id)
  order by coalesce(s.started_at, s.created_at) desc
  limit 1;

  if v_session_id is not null then
    session_id := v_session_id;
    role := case
      when (select player1_computer_id from public.sessions where id = v_session_id) = p_computer_id
        then 'player1'
      else 'player2'
    end;
    return next;
    return;
  end if;

  -- Reconnect to an open lobby this host already created.
  select s.id
    into v_session_id
  from public.sessions s
  where s.status = 'waiting'
    and s.player1_computer_id = p_computer_id
    and s.player2_computer_id is null
  order by s.created_at desc
  limit 1;

  if v_session_id is not null then
    session_id := v_session_id;
    role := 'player1';
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
end;
$$;

grant execute on function public.create_lobby(uuid) to anon, authenticated;
