begin;
create table public.lockd_overclock_hosts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  reported_specs text not null check (length(trim(reported_specs)) between 5 and 1000),
  registered_at timestamptz not null default now(),
  unique(owner_id, name)
);
alter table public.lockd_overclock_hosts enable row level security;
revoke all on public.lockd_overclock_hosts from public, anon, authenticated;
grant select, delete on public.lockd_overclock_hosts to authenticated;
grant insert(name, reported_specs), update(reported_specs) on public.lockd_overclock_hosts to authenticated;
create policy "Lister manages own reported PCs" on public.lockd_overclock_hosts
  for all to authenticated using (owner_id = (select auth.uid()) and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false))
  with check (owner_id = (select auth.uid()) and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false));
create function public.register_lockd_overclock_pc(p_name text,p_specs text) returns uuid
  language sql security invoker set search_path = '' as $$
    insert into public.lockd_overclock_hosts(name,reported_specs) values(trim(p_name),trim(p_specs))
    on conflict (owner_id,name) do update set reported_specs=excluded.reported_specs returning id;
  $$;
revoke all on function public.register_lockd_overclock_pc(text,text) from public,anon;
grant execute on function public.register_lockd_overclock_pc(text,text) to authenticated;
commit;
