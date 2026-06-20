-- Fix: join_session() can fail with ambiguous session_id on ON CONFLICT (same bug as matchmake).
-- Also ensures player2 invite joins atomically activate the session.

create or replace function public.join_session(
  p_session_id uuid,
  p_computer_id uuid
)
returns table (session_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions%rowtype;
begin
  insert into public.computers (id, last_seen_at)
  values (p_computer_id, now())
  on conflict (id) do update set last_seen_at = now();

  select *
    into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'session not found';
  end if;

  if v_session.status = 'ended' then
    raise exception 'session already ended';
  end if;

  if v_session.player1_computer_id = p_computer_id then
    session_id := p_session_id;
    role := 'player1';
  elsif v_session.player2_computer_id = p_computer_id then
    session_id := p_session_id;
    role := 'player2';
  elsif v_session.player1_computer_id is null then
    update public.sessions
      set player1_computer_id = p_computer_id,
          status = case when player2_computer_id is not null then 'active' else status end,
          started_at = case when player2_computer_id is not null then coalesce(started_at, now()) else started_at end
      where id = p_session_id;

    session_id := p_session_id;
    role := 'player1';
  elsif v_session.player2_computer_id is null and v_session.player1_computer_id is distinct from p_computer_id then
    update public.sessions
      set player2_computer_id = p_computer_id,
          status = 'active',
          started_at = coalesce(started_at, now())
      where id = p_session_id;

    session_id := p_session_id;
    role := 'player2';
  else
    raise exception 'session is full';
  end if;

  insert into public.session_state (session_id) values (p_session_id)
  on conflict on constraint session_state_pkey do nothing;

  return next;
end;
$$;

grant execute on function public.join_session(uuid, uuid) to anon, authenticated;
