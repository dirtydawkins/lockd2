-- Reuse existing publication validation; locality identities are checked against server-sourced places.
begin;
alter table public.lockd_listings add column if not exists location_place_id uuid references public.lockd_places(id);
create table if not exists public.lockd_listing_private_locations (
 listing_id uuid primary key references public.lockd_listings(id), owner_id uuid not null references auth.users(id),
 address text not null default '' check(length(address)<=500), pickup_instructions text not null default '' check(length(pickup_instructions)<=2000),
 return_instructions text not null default '' check(length(return_instructions)<=2000), updated_at timestamptz not null default now()
);
alter table public.lockd_listing_private_locations enable row level security;
revoke all on public.lockd_listing_private_locations from anon,authenticated;
create index if not exists lockd_private_location_owner on public.lockd_listing_private_locations(owner_id);
alter function public.create_lockd_listing(jsonb,jsonb,boolean) rename to lockd_create_listing_validated_base;
alter function public.my_lockd_listings() rename to lockd_my_listings_base;
alter function public.set_my_lockd_listing_status(uuid,text) rename to lockd_set_listing_status_base;
revoke all on function public.lockd_create_listing_validated_base(jsonb,jsonb,boolean),public.lockd_my_listings_base(),public.lockd_set_listing_status_base(uuid,text) from public,anon,authenticated;
create or replace function public.create_lockd_listing(p_listing jsonb,p_availability jsonb default '{}',p_publish boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare place public.lockd_places%rowtype; result jsonb; attributes jsonb; place_id uuid; address text; pickup text; returning_to text;
begin
 if auth.uid() is null then raise exception 'Sign in to manage your listings.';end if;
 if jsonb_typeof(p_listing)<>'object' then raise exception 'Add a valid title and location.';end if;
 begin place_id:=nullif(p_listing->>'location_place_id','')::uuid;exception when others then raise exception 'Choose a place from the search results.';end;
 if place_id is not null then select * into place from public.lockd_places where id=place_id;end if;
 if (p_publish or place_id is not null) and place.id is null then raise exception 'Choose a place from the search results.';end if;
 if place.id is not null then p_listing:=jsonb_set(p_listing,'{location_label}',to_jsonb(place.label));end if;
 attributes:=coalesce(p_listing->'attributes','{}');
 address:=trim(coalesce(p_listing->>'private_address',''));
 pickup:=trim(coalesce(p_listing->>'private_pickup_instructions',attributes->>'pickup_instructions',''));
 returning_to:=trim(coalesce(p_listing->>'private_return_instructions',attributes->>'return_instructions',''));
 if length(address)>500 or length(pickup)>2000 or length(returning_to)>2000 then raise exception 'Shorten the address or pickup instructions.';end if;
 p_listing:=jsonb_set(p_listing,'{attributes}',attributes-'pickup_instructions'-'return_instructions');
 result:=public.lockd_create_listing_validated_base(p_listing,p_availability,p_publish);
 update public.lockd_listings set location_place_id=place.id,
 location_latitude=case when place.id is null then null else round(place.latitude::numeric,2)::double precision end,
 location_longitude=case when place.id is null then null else round(place.longitude::numeric,2)::double precision end
 where id=(result->>'id')::uuid and owner_id=auth.uid();
 insert into public.lockd_listing_private_locations(listing_id,owner_id,address,pickup_instructions,return_instructions)
 values((result->>'id')::uuid,auth.uid(),address,pickup,returning_to)
 on conflict(listing_id)do update set address=excluded.address,pickup_instructions=excluded.pickup_instructions,return_instructions=excluded.return_instructions,updated_at=now()
 where public.lockd_listing_private_locations.owner_id=auth.uid();
 return result;
end$$;
-- Legacy route cannot bypass verified locality selection or replace its public point with an arbitrary coordinate.
create or replace function public.create_lockd_listing_with_location(p_listing jsonb,p_availability jsonb default '{}',p_publish boolean default false,p_location_latitude double precision default null,p_location_longitude double precision default null,p_clear_location boolean default false)
returns jsonb language sql security definer set search_path=public,pg_temp as $$select public.create_lockd_listing(p_listing,p_availability,p_publish)$$;
create or replace function public.my_lockd_listings() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to manage your listings.';end if;
 select coalesce(jsonb_agg(item||jsonb_build_object('location_place_id',l.location_place_id,'private_address',coalesce(p.address,''),'private_pickup_instructions',coalesce(p.pickup_instructions,''),'private_return_instructions',coalesce(p.return_instructions,'')) order by l.updated_at desc),'[]') into result
 from jsonb_array_elements(public.lockd_my_listings_base())item join public.lockd_listings l on l.id=(item->>'id')::uuid and l.owner_id=auth.uid()
 left join public.lockd_listing_private_locations p on p.listing_id=l.id and p.owner_id=auth.uid();
 return result;
end$$;
create or replace function public.set_my_lockd_listing_status(p_listing_id uuid,p_status text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare listing public.lockd_listings%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to manage your listings.';end if;
 select * into listing from public.lockd_listings where id=p_listing_id and owner_id=auth.uid() for update;
 if listing.id is null then raise exception 'This listing is unavailable or cannot be changed.';end if;
 if p_status='published' then
  if listing.listing_status not in('paused','published') or listing.approval_status<>'approved' then raise exception 'Open your listing and review the details before publishing.';end if;
  if listing.location_place_id is null or not exists(select 1 from public.lockd_places where id=listing.location_place_id) then raise exception 'Choose a place from the search results.';end if;
  if not exists(select 1 from public.lockd_listing_availability where listing_id=listing.id and calendar_date>=current_date and available_units>0) then raise exception 'Update the available dates before publishing.';end if;
 end if;
 return public.lockd_set_listing_status_base(p_listing_id,p_status);
end$$;
revoke all on function public.create_lockd_listing(jsonb,jsonb,boolean),public.create_lockd_listing_with_location(jsonb,jsonb,boolean,double precision,double precision,boolean),public.my_lockd_listings(),public.set_my_lockd_listing_status(uuid,text) from public,anon;
grant execute on function public.create_lockd_listing(jsonb,jsonb,boolean),public.create_lockd_listing_with_location(jsonb,jsonb,boolean,double precision,double precision,boolean),public.my_lockd_listings(),public.set_my_lockd_listing_status(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
