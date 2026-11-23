begin;

create table public.lockd_overclock_pilot (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  track text not null check (track in ('play', 'studio', 'ai')),
  requested_at timestamptz not null default now()
);
alter table public.lockd_overclock_pilot enable row level security;
revoke all on public.lockd_overclock_pilot from public, anon, authenticated;
grant select, delete on public.lockd_overclock_pilot to authenticated;
grant insert (track), update (track) on public.lockd_overclock_pilot to authenticated;
grant select on public.lockd_overclock_pilot to service_role;
create policy "Manage own Overclock pilot request"
  on public.lockd_overclock_pilot for all to authenticated
  using (user_id = (select auth.uid()) and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false))
  with check (user_id = (select auth.uid()) and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false));

create function public.set_lockd_overclock_interest(p_track text)
returns table (track text)
language sql
security invoker
set search_path = ''
as $$
  insert into public.lockd_overclock_pilot as interest (track)
  values (p_track)
  on conflict (user_id) do update set track = excluded.track
  returning interest.track;
$$;
revoke all on function public.set_lockd_overclock_interest(text) from public, anon, authenticated;
grant execute on function public.set_lockd_overclock_interest(text) to authenticated;

commit;
