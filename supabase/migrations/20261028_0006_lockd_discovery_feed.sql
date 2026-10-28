-- Additive location-aware discovery and publication timestamps.
-- Apply only after the existing LOCKD catalogue and owner-publishing migrations.
-- Coordinates are owner-provided approximate pins. They are not granted for public table reads.

alter table public.lockd_listings
  add column if not exists location_latitude double precision,
  add column if not exists location_longitude double precision,
  add column if not exists published_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lockd_listings_location_latitude_range_check') then
    alter table public.lockd_listings add constraint lockd_listings_location_latitude_range_check
      check (location_latitude is null or location_latitude between -90 and 90) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lockd_listings_location_longitude_range_check') then
    alter table public.lockd_listings add constraint lockd_listings_location_longitude_range_check
      check (location_longitude is null or location_longitude between -180 and 180) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lockd_listings_location_pair_check') then
    alter table public.lockd_listings add constraint lockd_listings_location_pair_check
      check ((location_latitude is null) = (location_longitude is null)) not valid;
  end if;
end;
$$;

alter table public.lockd_listings validate constraint lockd_listings_location_latitude_range_check;
alter table public.lockd_listings validate constraint lockd_listings_location_longitude_range_check;
alter table public.lockd_listings validate constraint lockd_listings_location_pair_check;

create index if not exists lockd_listings_public_location_idx
  on public.lockd_listings (location_latitude, location_longitude)
  where listing_status = 'published'
    and approval_status = 'approved'
    and location_latitude is not null
    and location_longitude is not null;

create index if not exists lockd_listings_public_longitude_idx
  on public.lockd_listings (location_longitude)
  where listing_status = 'published'
    and approval_status = 'approved'
    and location_latitude is not null
    and location_longitude is not null;

create index if not exists lockd_listings_publication_time_idx
  on public.lockd_listings (published_at desc)
  where listing_status = 'published' and approval_status = 'approved';

create or replace function public.set_lockd_publication_timestamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.listing_status = 'published' and new.approval_status = 'approved' then
    if tg_op = 'INSERT'
       or old.listing_status is distinct from 'published'
       or old.approval_status is distinct from 'approved' then
      new.published_at := now();
    else
      new.published_at := coalesce(new.published_at, old.published_at, now());
    end if;
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists lockd_listings_set_publication_timestamp on public.lockd_listings;
create trigger lockd_listings_set_publication_timestamp
before insert or update of listing_status, approval_status on public.lockd_listings
for each row execute function public.set_lockd_publication_timestamp();

revoke select on public.lockd_listings from anon, authenticated;
grant select (
  id, slug, title, category, market_category, summary, description, images, image_alt,
  location_label, price_amount, currency, price_unit, deposit_amount, deposit_currency,
  rental_durations, collection_available, delivery_available, attributes,
  requires_approval, checkout_enabled, listing_status, approval_status, created_at, published_at
) on public.lockd_listings to anon, authenticated;

create or replace function public.search_lockd_nearby_listings(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 10,
  p_category text default null,
  p_market text default null,
  p_available_ids uuid[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_currency text default null,
  p_guests integer default null,
  p_page integer default 0,
  p_page_size integer default 12
)
returns table (listing_id uuid, distance_km integer, total_count bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lon_delta double precision;
begin
  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180 then
    raise exception using message = 'Choose a valid approximate location.';
  end if;
  if p_radius_km is null or p_radius_km not between 1 and 100 then
    raise exception using message = 'Choose a search radius between 1 and 100 km.';
  end if;
  if p_category is not null and p_category not in ('stay','drive','play','technology','experience','camera','phone','laptop','audio','creative','other') then
    raise exception using message = 'Choose a supported rental category.';
  end if;
  if p_market is not null and p_market <> 'tech' then
    raise exception using message = 'Choose a supported rental market.';
  end if;
  if p_market = 'tech' and p_category is not null and p_category not in ('technology','play','camera','phone','laptop','audio','creative') then
    raise exception using message = 'Choose a technology category.';
  end if;
  if p_min_price is not null and p_min_price not between 0 and 100000000 then
    raise exception using message = 'Choose a valid minimum price.';
  end if;
  if p_max_price is not null and p_max_price not between 0 and 100000000 then
    raise exception using message = 'Choose a valid maximum price.';
  end if;
  if p_min_price is not null and p_max_price is not null and p_min_price > p_max_price then
    raise exception using message = 'Minimum price cannot exceed maximum price.';
  end if;
  if p_currency is not null and p_currency not in ('KES','USD','EUR') then
    raise exception using message = 'Choose a supported currency.';
  end if;
  if p_guests is not null and p_guests not between 1 and 20 then
    raise exception using message = 'Guest count must be between 1 and 20.';
  end if;
  if p_page is null or p_page not between 0 and 1000 or p_page_size is null or p_page_size not between 1 and 24 then
    raise exception using message = 'Choose a valid results page.';
  end if;

  v_lon_delta := least(180.0, p_radius_km / (111.32 * greatest(0.01, abs(cos(radians(p_latitude))))));

  return query
  with candidates as (
    select l.id,
      6371.0088 * 2 * asin(sqrt(least(1.0, greatest(0.0,
        power(sin(radians(l.location_latitude - p_latitude) / 2), 2)
        + cos(radians(p_latitude)) * cos(radians(l.location_latitude))
        * power(sin(radians(l.location_longitude - p_longitude) / 2), 2)
      )))) as exact_distance_km,
      l.published_at
    from public.lockd_listings l
    where l.listing_status = 'published'
      and l.approval_status = 'approved'
      and l.location_latitude is not null
      and l.location_longitude is not null
      and l.location_latitude between p_latitude - (p_radius_km / 111.32) and p_latitude + (p_radius_km / 111.32)
      and (abs(p_latitude) > 89.5 or l.location_longitude between p_longitude - v_lon_delta and p_longitude + v_lon_delta
        or (p_longitude - v_lon_delta < -180 and l.location_longitude >= 180 + (p_longitude - v_lon_delta))
        or (p_longitude + v_lon_delta > 180 and l.location_longitude <= -180 + (p_longitude + v_lon_delta)))
      and (p_category is null or l.category = p_category)
      and (p_market is null or l.category in ('technology','play','camera','phone','laptop','audio','creative'))
      and (p_available_ids is null or l.id = any(p_available_ids))
      and (p_min_price is null or l.price_amount >= p_min_price)
      and (p_max_price is null or l.price_amount <= p_max_price)
      and (p_currency is null or l.currency = p_currency)
      and (p_guests is null or case
        when coalesce(l.attributes->>'max_guests','') ~ '^[0-9]{1,2}$' then (l.attributes->>'max_guests')::integer >= p_guests
        else false end)
  ),
  nearby as (
    select c.id, c.exact_distance_km, c.published_at
    from candidates c
    where c.exact_distance_km <= p_radius_km
  )
  select n.id,
    case when n.exact_distance_km < 0.5 then 0 else round(n.exact_distance_km)::integer end,
    count(*) over ()
  from nearby n
  order by n.exact_distance_km asc, n.published_at desc nulls last
  limit p_page_size offset p_page * p_page_size;
end;
$$;

revoke all on function public.search_lockd_nearby_listings(double precision,double precision,double precision,text,text,uuid[],numeric,numeric,text,integer,integer,integer) from public;
grant execute on function public.search_lockd_nearby_listings(double precision,double precision,double precision,text,text,uuid[],numeric,numeric,text,integer,integer,integer) to anon, authenticated;

create or replace function public.create_lockd_listing_with_location(
  p_listing jsonb,
  p_availability jsonb default '{}'::jsonb,
  p_publish boolean default false,
  p_location_latitude double precision default null,
  p_location_longitude double precision default null,
  p_clear_location boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_id uuid;
begin
  if auth.uid() is null then raise exception using message = 'Sign in to manage your listings.'; end if;
  if (p_location_latitude is null) <> (p_location_longitude is null) then
    raise exception using message = 'Add both approximate map coordinates or leave both blank.';
  end if;
  if p_location_latitude is not null and (p_location_latitude not between -90 and 90 or p_location_longitude not between -180 and 180) then
    raise exception using message = 'Choose valid approximate map coordinates.';
  end if;
  if p_clear_location and p_location_latitude is not null then
    raise exception using message = 'Clear the approximate pin or provide a new one.';
  end if;

  v_result := public.create_lockd_listing(p_listing, coalesce(p_availability, '{}'::jsonb), coalesce(p_publish, false));
  v_id := (v_result->>'id')::uuid;
  if p_clear_location or p_location_latitude is not null then
    update public.lockd_listings
    set location_latitude = case when p_clear_location then null else round(p_location_latitude::numeric, 2)::double precision end,
        location_longitude = case when p_clear_location then null else round(p_location_longitude::numeric, 2)::double precision end,
        updated_at = now()
    where id = v_id and owner_id = auth.uid();
    if not found then raise exception using message = 'This listing is unavailable or cannot be changed.'; end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_lockd_listing_with_location(jsonb,jsonb,boolean,double precision,double precision,boolean) from public, anon;
grant execute on function public.create_lockd_listing_with_location(jsonb,jsonb,boolean,double precision,double precision,boolean) to authenticated;

-- Keep owner pins editable while returning them only through the authenticated, owner-scoped RPC.
create or replace function public.my_lockd_listings()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception using message = 'Sign in to manage your listings.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'slug', l.slug, 'title', l.title, 'category', l.category,
      'summary', l.summary, 'description', l.description, 'images', l.images,
      'image_alt', l.image_alt, 'location_label', l.location_label, 'attributes', l.attributes,
      'price_amount', l.price_amount, 'currency', l.currency, 'price_unit', l.price_unit,
      'deposit_amount', l.deposit_amount, 'collection_available', l.collection_available,
      'delivery_available', l.delivery_available, 'min_rental_days', l.min_rental_days,
      'location_latitude', l.location_latitude, 'location_longitude', l.location_longitude,
      'availability', case when a.calendar_start is null then null else jsonb_build_object(
        'startDate', a.calendar_start, 'endDate', a.calendar_end, 'units', a.units
      ) end,
      'listing_status', l.listing_status, 'approval_status', l.approval_status,
      'updated_at', l.updated_at
    ) order by l.updated_at desc)
    from public.lockd_listings l
    left join lateral (
      select min(c.calendar_date) as calendar_start,
             max(c.calendar_date) + 1 as calendar_end,
             min(c.available_units) as units
      from public.lockd_listing_availability c
      where c.listing_id = l.id
      having count(*) > 0 and count(*) = (max(c.calendar_date) - min(c.calendar_date) + 1)
    ) a on true
    where l.owner_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_lockd_listings() from public, anon;
grant execute on function public.my_lockd_listings() to authenticated;
