-- Genuine locality reference data only. Populated by the server geocoder, never by a lister.
begin;
create table if not exists public.lockd_places (
 id uuid primary key default gen_random_uuid(), provider text not null check(provider='geoapify'),
 provider_id text not null unique check(length(provider_id) between 1 and 1024),
 label text not null check(length(label) between 2 and 160), country_code text not null check(country_code ~ '^[A-Z]{2}$'),
 latitude double precision not null check(latitude between -90 and 90), longitude double precision not null check(longitude between -180 and 180),
 verified_at timestamptz not null default now()
);
create table if not exists public.lockd_place_search_cache (
 query_hash text primary key check(query_hash ~ '^[a-f0-9]{64}$'), place_ids uuid[] not null default '{}',
 expires_at timestamptz not null default now()+interval '30 days'
);
create table if not exists public.lockd_geocoding_budget (
 singleton boolean primary key default true check(singleton), day date not null default current_date,
 used integer not null default 0, last_request_at timestamptz
);
alter table public.lockd_places enable row level security;
alter table public.lockd_place_search_cache enable row level security;
alter table public.lockd_geocoding_budget enable row level security;
revoke all on public.lockd_places,public.lockd_place_search_cache,public.lockd_geocoding_budget from anon,authenticated;
grant all on public.lockd_places,public.lockd_place_search_cache,public.lockd_geocoding_budget to service_role;
create or replace function public.lockd_claim_place_lookup() returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare budget public.lockd_geocoding_budget%rowtype;
begin
 insert into public.lockd_geocoding_budget(singleton) values(true) on conflict do nothing;
 select * into budget from public.lockd_geocoding_budget where singleton for update;
 if budget.day<>current_date then budget.used:=0;end if;
 -- A hard application cap below the Free plan's allowance; no paid fallback.
 if budget.used>=2500 or budget.last_request_at>clock_timestamp()-interval '400 milliseconds' then return false;end if;
 update public.lockd_geocoding_budget set day=current_date,used=budget.used+1,last_request_at=clock_timestamp() where singleton;
 return true;
end$$;
revoke all on function public.lockd_claim_place_lookup() from public,anon,authenticated;
grant execute on function public.lockd_claim_place_lookup() to service_role;
create or replace function public.get_lockd_place(p_place_id uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',id,'label',label,'country',country_code,'latitude',round(latitude::numeric,2),'longitude',round(longitude::numeric,2)) from public.lockd_places where id=p_place_id
$$;
revoke all on function public.get_lockd_place(uuid) from public;
grant execute on function public.get_lockd_place(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
