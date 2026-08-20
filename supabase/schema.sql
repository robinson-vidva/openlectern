-- OpenLectern schema. Paste into the Supabase SQL editor and run once.
-- Design: one table, no direct writes from clients. All writes go through
-- SECURITY DEFINER functions that verify the PIN server-side with pgcrypto.

create extension if not exists pgcrypto;

create table if not exists public.sessions (
  code       text primary key,
  pin_hash   text not null,
  config     jsonb not null default '{}'::jsonb,
  state      jsonb not null default '{"current": null, "queue": [], "blank": false}'::jsonb,
  admins     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

-- Row Level Security: reads allowed for non-expired rows (needed for realtime),
-- but no insert/update/delete policies exist, so clients cannot write directly.
alter table public.sessions enable row level security;

drop policy if exists "read non-expired sessions" on public.sessions;
create policy "read non-expired sessions"
  on public.sessions for select
  using (expires_at > now());

-- Never expose pin_hash to client roles. Grant column-level SELECT on the rest
-- so direct queries and realtime payloads never carry the hash.
revoke all on public.sessions from anon, authenticated;
grant select (code, config, state, admins, created_at, expires_at)
  on public.sessions to anon, authenticated;

-- Realtime: broadcast row changes to presenter + all controllers.
-- Idempotent: skip if the table is already in the publication.
do $$
begin
  alter publication supabase_realtime add table public.sessions;
exception
  when duplicate_object then null;
end
$$;

-- Opportunistic cleanup of expired sessions. Called from the write functions.
create or replace function public.cleanup_expired_sessions()
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from public.sessions where expires_at < now();
$$;

-- Public projection of a row (never includes pin_hash).
create or replace function public.session_public(s public.sessions)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'code', s.code,
    'config', s.config,
    'state', s.state,
    'admins', s.admins,
    'created_at', s.created_at,
    'expires_at', s.expires_at
  );
$$;

-- create_session(pin, config) -> jsonb { code, ... }
create or replace function public.create_session(pin text, config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_code text;
  i int;
  s public.sessions;
begin
  if pin is null or pin !~ '^[0-9]{4}$' then
    raise exception 'pin must be exactly 4 digits' using errcode = '22023';
  end if;

  perform public.cleanup_expired_sessions();

  loop
    new_code := '';
    for i in 1..6 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.sessions where code = new_code);
  end loop;

  insert into public.sessions (code, pin_hash, config)
  values (new_code, crypt(pin, gen_salt('bf')), coalesce(config, '{}'::jsonb))
  returning * into s;

  return public.session_public(s);
end;
$$;

-- join_session(code, pin) -> full public row, or raises on bad/expired.
create or replace function public.join_session(code text, pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.sessions;
begin
  perform public.cleanup_expired_sessions();

  select * into s from public.sessions where sessions.code = upper(trim(join_session.code));

  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if s.expires_at <= now() then
    delete from public.sessions where sessions.code = s.code;
    raise exception 'session expired' using errcode = 'P0003';
  end if;
  if s.pin_hash <> crypt(pin, s.pin_hash) then
    raise exception 'incorrect pin' using errcode = '28000';
  end if;

  return public.session_public(s);
end;
$$;

-- update_session(code, pin, patch) -> merged public row.
-- patch may contain any of: state (shallow-merged), config (replaced),
-- admins (replaced). PIN is verified before any write.
create or replace function public.update_session(code text, pin text, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.sessions;
begin
  select * into s from public.sessions where sessions.code = upper(trim(update_session.code));

  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if s.expires_at <= now() then
    delete from public.sessions where sessions.code = s.code;
    raise exception 'session expired' using errcode = 'P0003';
  end if;
  if s.pin_hash <> crypt(pin, s.pin_hash) then
    raise exception 'incorrect pin' using errcode = '28000';
  end if;

  update public.sessions set
    state  = case when patch ? 'state'  then state || (patch -> 'state') else state end,
    config = case when patch ? 'config' then patch -> 'config' else config end,
    admins = case when patch ? 'admins' then patch -> 'admins' else admins end
  where sessions.code = s.code
  returning * into s;

  return public.session_public(s);
end;
$$;

-- Internal helpers must not be callable via the REST API.
revoke all on function public.cleanup_expired_sessions() from public, anon, authenticated;
revoke all on function public.session_public(public.sessions) from public, anon, authenticated;

-- Only the three RPCs are callable by clients.
revoke all on function public.create_session(text, jsonb) from public;
revoke all on function public.join_session(text, text) from public;
revoke all on function public.update_session(text, text, jsonb) from public;
grant execute on function public.create_session(text, jsonb) to anon, authenticated;
grant execute on function public.join_session(text, text) to anon, authenticated;
grant execute on function public.update_session(text, text, jsonb) to anon, authenticated;
