-- Indexed, relevance-ranked public catalogue search. Search material is derived
-- only from public listing fields and never granted as a directly readable column.

create schema if not exists extensions;
set search_path = public, extensions, pg_temp;
create extension if not exists pg_trgm with schema extensions;

alter table public.lockd_listings
  add column if not exists search_vector tsvector not null default ''::tsvector;

create or replace function public.refresh_lockd_listing_search_document()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_category_label text;
begin
  v_category_label := case new.category
    when 'stay' then 'Accommodation rooms apartments holiday homes hotels'
    when 'drive' then 'Cars Mobility vehicles car SUV sedan coupe hatchback motorcycle'
    when 'play' then 'Gaming consoles equipment'
    when 'technology' then 'Technology gadgets electronics'
    when 'experience' then 'Experiences destinations activities safari'
    when 'camera' then 'Cameras creator equipment photography'
    when 'phone' then 'Phones mobile devices'
    when 'laptop' then 'Computers laptops'
    when 'audio' then 'Audio sound equipment'
    when 'creative' then 'Creative equipment'
    else 'Other rentals'
  end;

  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('simple', concat_ws(' ',
      new.attributes->>'brand', new.attributes->>'model',
      new.attributes->>'configuration', new.attributes->>'destination',
      new.attributes->>'vehicle_type', new.attributes->>'property_type',
      new.attributes->>'product_type', v_category_label
    )), 'A') ||
    setweight(to_tsvector('simple', concat_ws(' ',
      new.category, new.market_category, new.location_label,
      new.attributes->>'specifications', new.attributes->>'amenities',
      new.attributes->>'tags', new.attributes->>'included_accessories'
    )), 'B') ||
    setweight(to_tsvector('simple', concat_ws(' ', new.summary, new.description, new.attributes::text)), 'C');
  return new;
end;
$$;

drop trigger if exists lockd_listing_search_document on public.lockd_listings;
create trigger lockd_listing_search_document
  before insert or update on public.lockd_listings
  for each row execute function public.refresh_lockd_listing_search_document();

update public.lockd_listings set search_vector = search_vector;

create index if not exists lockd_listings_search_vector_idx
  on public.lockd_listings using gin (search_vector)
  where listing_status = 'published' and approval_status = 'approved';

create index if not exists lockd_listings_search_title_trgm_idx
  on public.lockd_listings using gin (lower(title) gin_trgm_ops)
  where listing_status = 'published' and approval_status = 'approved';

create index if not exists lockd_listings_search_brand_trgm_idx
  on public.lockd_listings using gin (lower(attributes->>'brand') gin_trgm_ops)
  where listing_status = 'published' and approval_status = 'approved';

create index if not exists lockd_listings_search_model_trgm_idx
  on public.lockd_listings using gin (lower(attributes->>'model') gin_trgm_ops)
  where listing_status = 'published' and approval_status = 'approved';

create index if not exists lockd_listings_search_location_trgm_idx
  on public.lockd_listings using gin (lower(location_label) gin_trgm_ops)
  where listing_status = 'published' and approval_status = 'approved';

create index if not exists lockd_listings_public_price_idx
  on public.lockd_listings (currency, price_amount)
  where listing_status = 'published' and approval_status = 'approved';

create or replace function public.search_lockd_listings(
  p_query text,
  p_filters jsonb default '{}'::jsonb,
  p_available_ids uuid[] default null,
  p_sort text default 'relevance',
  p_page integer default 0,
  p_page_size integer default 24
)
returns table (listing_id uuid, search_rank real, total_count bigint)
language plpgsql
stable
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  v_query text;
  v_tsquery tsquery;
  v_category text := nullif(p_filters->>'category', '');
  v_market text := nullif(p_filters->>'market', '');
  v_group text := nullif(p_filters->>'group', '');
  v_group_categories text[];
  v_tech_categories text[] := array['technology', 'play', 'camera', 'phone', 'laptop', 'audio', 'creative'];
  v_min_price numeric;
  v_max_price numeric;
  v_currency text := nullif(p_filters->>'currency', '');
  v_location text := nullif(p_filters->>'location', '');
  v_page integer := coalesce(p_page, 0);
  v_page_size integer := coalesce(p_page_size, 24);
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'object'
     or p_query is null or length(p_query) > 100
     or v_page < 0 or v_page > 1000 or v_page_size < 1 or v_page_size > 24
     or p_sort is null or p_sort not in ('relevance', 'newest', 'price-low', 'price-high') then
    return;
  end if;

  begin
    v_min_price := nullif(p_filters->>'minPrice', '')::numeric;
    v_max_price := nullif(p_filters->>'maxPrice', '')::numeric;
  exception when others then
    return;
  end;
  if (v_min_price is not null and (v_min_price < 0 or v_min_price > 100000000))
     or (v_max_price is not null and (v_max_price < 0 or v_max_price > 100000000))
     or (v_min_price is not null and v_max_price is not null and v_min_price > v_max_price)
     or length(coalesce(v_location, '')) > 100
     or length(coalesce(nullif(p_filters->>'brand', ''), '')) > 100 then
    return;
  end if;
  if (nullif(p_filters->>'guests', '') is not null and (
        p_filters->>'guests' !~ '^\d{1,2}$'
        or (case when p_filters->>'guests' ~ '^\d{1,2}$' then (p_filters->>'guests')::integer else 0 end) not between 1 and 20
      ))
     or (nullif(p_filters->>'seats', '') is not null and (
        p_filters->>'seats' !~ '^\d{1,2}$'
        or (case when p_filters->>'seats' ~ '^\d{1,2}$' then (p_filters->>'seats')::integer else 0 end) not between 1 and 40
      ))
     or (nullif(p_filters->>'driverAge', '') is not null and (
        p_filters->>'driverAge' !~ '^\d{1,3}$'
        or (case when p_filters->>'driverAge' ~ '^\d{1,3}$' then (p_filters->>'driverAge')::integer else 0 end) not between 18 and 100
      )) then
    return;
  end if;
  if (nullif(p_filters->>'collection', '') is not null and p_filters->>'collection' not in ('true', 'false'))
     or (nullif(p_filters->>'delivery', '') is not null and p_filters->>'delivery' not in ('true', 'false')) then
    return;
  end if;

  if v_category is not null and v_category not in (
    'stay', 'drive', 'play', 'technology', 'experience', 'camera', 'phone', 'laptop', 'audio', 'creative', 'other'
  ) then return; end if;
  if v_market is not null and v_market <> 'tech' then return; end if;
  if v_market = 'tech' and v_category is not null and not (v_category = any(v_tech_categories)) then return; end if;
  if v_group is not null and v_group not in ('gaming', 'phones', 'computers', 'creator', 'audio', 'work') then return; end if;
  if v_category is not null and v_group is not null then return; end if;

  v_group_categories := case v_group
    when 'gaming' then array['play']
    when 'phones' then array['phone']
    when 'computers' then array['laptop']
    when 'creator' then array['camera', 'creative']
    when 'audio' then array['audio']
    when 'work' then array['laptop']
    else null
  end;

  v_query := trim(regexp_replace(regexp_replace(p_query, '[^[:alnum:] _-]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'));
  select string_agg(token, ' ' order by token_order)
    into v_query
    from regexp_split_to_table(v_query, ' ') with ordinality as parts(token, token_order)
    where lower(token) not in ('a', 'an', 'and', 'at', 'for', 'in', 'near', 'of', 'the', 'to', 'with');
  if v_query is null or v_query = '' then return; end if;
  v_tsquery := websearch_to_tsquery('simple', v_query);

  return query
  with matched as (
    select
      l.id,
      l.price_amount,
      l.created_at,
      case
        when lower(trim(l.title)) = lower(v_query) then 100::real
        when lower(coalesce(l.attributes->>'model', '')) = lower(v_query) then 96::real
        when lower(l.title) like lower(v_query) || '%' then 85::real
        when lower(coalesce(l.attributes->>'brand', '')) = lower(v_query) then 76::real
        when lower(l.title) like '%' || lower(v_query) || '%' then 68::real
        when l.search_vector @@ v_tsquery then 45::real + ts_rank(l.search_vector, v_tsquery)
        else 30::real + greatest(
          similarity(lower(l.title), lower(v_query)),
          similarity(lower(coalesce(l.attributes->>'model', '')), lower(v_query)),
          similarity(lower(coalesce(l.attributes->>'brand', '')), lower(v_query)),
          similarity(lower(coalesce(l.location_label, '')), lower(v_query))
        )
      end as rank
    from public.lockd_listings l
    where l.listing_status = 'published'
      and l.approval_status = 'approved'
      and (v_category is null or l.category = v_category)
      and (v_market is distinct from 'tech' or l.category = any(v_tech_categories))
      and (v_group is null or l.market_category = v_group or l.category = any(v_group_categories))
      and (v_location is null or lower(coalesce(l.location_label, '')) like '%' || lower(v_location) || '%')
      and (v_min_price is null or l.price_amount >= v_min_price)
      and (v_max_price is null or l.price_amount <= v_max_price)
      and (v_currency is null or l.currency = v_currency)
      and (p_available_ids is null or l.id = any(p_available_ids))
      and (nullif(p_filters->>'brand', '') is null or lower(coalesce(l.attributes->>'brand', '')) like '%' || lower(p_filters->>'brand') || '%')
      and (nullif(p_filters->>'type', '') is null or l.attributes->>'product_type' = p_filters->>'type')
      and (nullif(p_filters->>'condition', '') is null or l.attributes->>'condition' = p_filters->>'condition')
      and (nullif(p_filters->>'duration', '') is null or p_filters->>'duration' = any(l.rental_durations))
      and (nullif(p_filters->>'accessory', '') is null or coalesce(l.attributes->'included_accessories', '[]'::jsonb) @> jsonb_build_array(p_filters->>'accessory'))
      and (nullif(p_filters->>'propertyType', '') is null or l.attributes->>'property_type' = p_filters->>'propertyType')
      and (nullif(p_filters->>'amenity', '') is null or coalesce(l.attributes->'amenities', '[]'::jsonb) @> jsonb_build_array(p_filters->>'amenity'))
      and (nullif(p_filters->>'guests', '') is null or (
        coalesce(l.attributes->>'max_guests', '') ~ '^[0-9]+$'
        and (l.attributes->>'max_guests')::integer >= (p_filters->>'guests')::integer
      ))
      and (nullif(p_filters->>'vehicleType', '') is null or l.attributes->>'vehicle_type' = p_filters->>'vehicleType')
      and (nullif(p_filters->>'transmission', '') is null or l.attributes->>'transmission' = p_filters->>'transmission')
      and (nullif(p_filters->>'fuelType', '') is null or l.attributes->>'fuel_type' = p_filters->>'fuelType')
      and (nullif(p_filters->>'seats', '') is null or (
        coalesce(l.attributes->>'seating_capacity', '') ~ '^[0-9]+$'
        and (l.attributes->>'seating_capacity')::integer >= (p_filters->>'seats')::integer
      ))
      and (nullif(p_filters->>'driverAge', '') is null or (
        coalesce(l.attributes->>'minimum_driver_age', '') ~ '^[0-9]+$'
        and (l.attributes->>'minimum_driver_age')::integer <= (p_filters->>'driverAge')::integer
      ))
      and (nullif(p_filters->>'serviceMode', '') is null or l.attributes->>'service_mode' in (p_filters->>'serviceMode', 'both'))
      and (coalesce((p_filters->>'collection')::boolean, false) is false or l.collection_available is true)
      and (coalesce((p_filters->>'delivery')::boolean, false) is false or l.delivery_available is true)
      and (nullif(p_filters->>'useCase', '') is null or coalesce(l.attributes->'use_cases', '[]'::jsonb) @> jsonb_build_array(p_filters->>'useCase'))
      and (
        l.search_vector @@ v_tsquery
        or lower(l.title) % lower(v_query)
        or lower(coalesce(l.attributes->>'model', '')) % lower(v_query)
        or lower(coalesce(l.attributes->>'brand', '')) % lower(v_query)
        or lower(coalesce(l.location_label, '')) % lower(v_query)
      )
  ), counted as (
    select matched.*, count(*) over () as total
    from matched
  )
  select counted.id, counted.rank, counted.total
  from counted
  order by
    case when p_sort = 'price-low' then counted.price_amount end asc nulls last,
    case when p_sort = 'price-high' then counted.price_amount end desc nulls last,
    case when p_sort = 'relevance' then counted.rank end desc nulls last,
    case when p_sort = 'newest' then counted.created_at end desc nulls last,
    counted.rank desc,
    counted.created_at desc
  limit v_page_size
  offset v_page * v_page_size;
end;
$$;

revoke all on function public.search_lockd_listings(text, jsonb, uuid[], text, integer, integer) from public;
grant execute on function public.search_lockd_listings(text, jsonb, uuid[], text, integer, integer) to anon, authenticated;
