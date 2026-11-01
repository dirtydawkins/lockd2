-- Public, approximate map pins from the existing listing catalogue only.
begin;
create extension if not exists postgis with schema extensions;
do $$begin if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis' and n.nspname='extensions') then raise exception 'Use the existing PostGIS schema; do not relocate it automatically.';end if;end$$;
alter table public.lockd_listings add column if not exists location_geom extensions.geometry(Point,4326)
 generated always as(case when location_latitude is not null and location_longitude is not null then extensions.st_setsrid(extensions.st_makepoint(round(location_longitude::numeric,2)::double precision,round(location_latitude::numeric,2)::double precision),4326) else null end) stored;
create index if not exists lockd_listing_map_gist on public.lockd_listings using gist(location_geom) where listing_status='published' and approval_status='approved' and location_geom is not null;
create index if not exists lockd_listing_nearby_gist on public.lockd_listings using gist((location_geom::extensions.geography)) where listing_status='published' and approval_status='approved' and location_geom is not null;
create or replace function public.search_lockd_map_listings(
 p_south double precision,p_west double precision,p_north double precision,p_east double precision,
 p_category text default null,p_q text default '',p_min_price numeric default null,p_max_price numeric default null,
 p_currency text default null,p_start_date date default null,p_end_date date default null,
 p_quantity integer default 1,p_guests integer default null,p_page integer default 0
) returns jsonb language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare term text:=regexp_replace(trim(coalesce(p_q,'')),'\s+',' ','g'); result jsonb;
begin
 if p_south is null or p_north is null or p_west is null or p_east is null
 or p_south not between -90 and 90 or p_north not between -90 and 90 or p_south>=p_north
 or p_west not between -180 and 180 or p_east not between -180 and 180 or p_west=p_east then raise exception 'Choose a map area.';end if;
 if p_category is not null and p_category not in('stay','drive','play','technology','experience','camera','phone','laptop','audio','creative','other') then raise exception 'Invalid category.';end if;
 if length(term)>100 or p_page is null or p_page not between 0 and 1000 or p_quantity is null or p_quantity not between 1 and 20 or (p_guests is not null and p_guests not between 1 and 30) then raise exception 'Invalid search.';end if;
 if (p_min_price is not null and p_min_price not between 0 and 100000000) or (p_max_price is not null and p_max_price not between 0 and 100000000)
 or (p_min_price is not null and p_max_price is not null and p_min_price>p_max_price)
 or ((p_min_price is not null or p_max_price is not null) and p_currency is null)
 or (p_currency is not null and p_currency not in('KES','USD','EUR')) then raise exception 'Invalid price range.';end if;
 if (p_start_date is null)<>(p_end_date is null) or (p_start_date is not null and (p_start_date<current_date or p_end_date<=p_start_date or p_end_date-p_start_date>366)) then raise exception 'Invalid dates.';end if;
 if p_start_date is not null and (p_north-p_south>20 or case when p_west<p_east then p_east-p_west else 360-p_west+p_east end>20) then raise exception 'Zoom in to check dates.';end if;
 with positioned as materialized (
  select l.id,l.created_at,round(l.location_latitude::numeric,2)::double precision latitude,round(l.location_longitude::numeric,2)::double precision longitude
  from public.lockd_listings l
  where l.listing_status='published' and l.approval_status='approved' and l.location_latitude is not null and l.location_longitude is not null
  and l.location_geom is not null and ((p_west<p_east and extensions.st_intersects(l.location_geom,extensions.st_makeenvelope(p_west,p_south,p_east,p_north,4326))) or (p_west>p_east and (extensions.st_intersects(l.location_geom,extensions.st_makeenvelope(p_west,p_south,180,p_north,4326)) or extensions.st_intersects(l.location_geom,extensions.st_makeenvelope(-180,p_south,p_east,p_north,4326)))))
  and (p_category is null or l.category=p_category)
  and (p_currency is null or l.currency=p_currency)
  and (p_min_price is null or l.price_amount>=p_min_price) and (p_max_price is null or l.price_amount<=p_max_price)
  and (p_guests is null or (l.category='stay' and case when l.attributes->>'max_guests' ~ '^[0-9]{1,3}$' then (l.attributes->>'max_guests')::integer else 0 end>=p_guests))
  and (term='' or l.search_vector@@plainto_tsquery('simple',term) or (length(term)>=3 and extensions.similarity(lower(l.title),lower(term))>=0.3))
 ), eligible as materialized (
  select * from positioned x where p_start_date is null or public.check_lockd_listing_availability(x.id,p_start_date,p_end_date,p_quantity)
 ), page as (
  select * from eligible order by created_at desc,id limit 25 offset p_page*24
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('listing_id',x.id,'latitude',x.latitude,'longitude',x.longitude)) from(select * from page limit 24)x),'[]'),
  'hasMore',(select count(*)>24 from page),'total',(select count(*) from eligible)) into result;
 return result;
end $$;
revoke all on function public.search_lockd_map_listings(double precision,double precision,double precision,double precision,text,text,numeric,numeric,text,date,date,integer,integer,integer) from public;
grant execute on function public.search_lockd_map_listings(double precision,double precision,double precision,double precision,text,text,numeric,numeric,text,date,date,integer,integer,integer) to anon,authenticated;

-- Preserve the existing nearby endpoint contract while using its spatial index.
create or replace function public.search_lockd_nearby_listings(p_latitude double precision,p_longitude double precision,p_radius_km double precision default 10,p_category text default null,p_market text default null,p_available_ids uuid[] default null,p_min_price numeric default null,p_max_price numeric default null,p_currency text default null,p_guests integer default null,p_page integer default 0,p_page_size integer default 12)
returns table(listing_id uuid,distance_km integer,total_count bigint) language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
declare origin extensions.geography;
begin
 if p_latitude is null or p_longitude is null or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_radius_km is null or p_radius_km not between 1 and 100 then raise exception 'Choose a valid area.';end if;
 if p_category is not null and p_category not in('stay','drive','play','technology','experience','camera','phone','laptop','audio','creative','other') then raise exception 'Invalid category.';end if;
 if p_market is not null and p_market<>'tech' then raise exception 'Invalid category.';end if;
 if p_page is null or p_page not between 0 and 1000 or p_page_size is null or p_page_size not between 1 and 48 or (p_guests is not null and p_guests not between 1 and 30) then raise exception 'Invalid search.';end if;
 if (p_min_price is not null and p_min_price not between 0 and 100000000) or (p_max_price is not null and p_max_price not between 0 and 100000000) or (p_min_price is not null and p_max_price is not null and p_min_price>p_max_price) or ((p_min_price is not null or p_max_price is not null) and p_currency is null) or (p_currency is not null and p_currency not in('KES','USD','EUR')) then raise exception 'Invalid price range.';end if;
 origin:=extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography;
 return query with matching as materialized(
 select l.id,extensions.st_distance(l.location_geom::extensions.geography,origin) metres,l.created_at
 from public.lockd_listings l where l.listing_status='published' and l.approval_status='approved' and l.location_geom is not null
 and extensions.st_dwithin(l.location_geom::extensions.geography,origin,p_radius_km*1000)
 and (p_category is null or l.category=p_category)
 and (p_market is null or l.category in('technology','play','camera','phone','laptop','audio','creative'))
 and (p_available_ids is null or l.id=any(p_available_ids))
 and (p_currency is null or l.currency=p_currency)
 and (p_min_price is null or l.price_amount>=p_min_price) and (p_max_price is null or l.price_amount<=p_max_price)
 and (p_guests is null or (l.category='stay' and case when l.attributes->>'max_guests' ~ '^[0-9]{1,3}$' then (l.attributes->>'max_guests')::integer else 0 end>=p_guests))
 )select x.id,round(x.metres/1000)::integer,count(*)over() from matching x order by x.metres,x.created_at desc,x.id limit p_page_size offset p_page*p_page_size;
end $$;
revoke all on function public.search_lockd_nearby_listings(double precision,double precision,double precision,text,text,uuid[],numeric,numeric,text,integer,integer,integer) from public;
grant execute on function public.search_lockd_nearby_listings(double precision,double precision,double precision,text,text,uuid[],numeric,numeric,text,integer,integer,integer) to anon,authenticated;

notify pgrst,'reload schema';
commit;
