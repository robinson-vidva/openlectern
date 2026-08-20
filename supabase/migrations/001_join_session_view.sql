-- Read-only presenter/viewer join: code only, no PIN. Paste into the Supabase
-- SQL editor. Additive and non-breaking; the app falls back to a direct RLS read
-- until this is applied, so existing sessions keep working.

create or replace function public.join_session_view(code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.sessions;
begin
  perform public.cleanup_expired_sessions();

  select * into s from public.sessions where sessions.code = upper(trim(join_session_view.code));

  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if s.expires_at <= now() then
    delete from public.sessions where sessions.code = s.code;
    raise exception 'session expired' using errcode = 'P0003';
  end if;

  return public.session_public(s);
end;
$$;

revoke all on function public.join_session_view(text) from public;
grant execute on function public.join_session_view(text) to anon, authenticated;
