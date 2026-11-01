-- Repair deployment drift: owner publishing, indexed search and discovery RPCs were absent.
-- Replays the existing idempotent definitions; no inventory is inserted.
begin;
-- Restore existing source: 20261028_0004_lockd_owner_publishing.sql
-- Authenticated owner listing creation and owner-managed listing photographs.
-- Owners publish complete listings directly; administrator moderation remains post-publication.
-- This migration is additive and does not seed inventory or alter existing listings.

alter table public.lockd_listings
  drop constraint if exists lockd_listings_listing_status_check;

alter table public.lockd_listings
  add constraint lockd_listings_listing_status_check check (listing_status in (
    'draft', 'pending_review', 'needs_changes', 'rejected', 'suspended', 'archived', 'paused', 'published'
  ));

-- Photos stay in a private bucket. Public listing reads use short-lived signed URLs;
-- object signing is allowed only for the owner's own files or published listings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lockd-listings', 'lockd-listings', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can read LOCKD listing photos" on storage.objects;
drop policy if exists "Owners can read LOCKD listing photos" on storage.objects;
create policy "Owners can read LOCKD listing photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'lockd-listings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public can sign published LOCKD listing photos" on storage.objects;
create policy "Public can sign published LOCKD listing photos"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'lockd-listings'
    and exists (
      select 1
      from public.lockd_listings listing
      where listing.listing_status = 'published'
        and listing.approval_status = 'approved'
        and listing.images @> jsonb_build_array(storage.objects.name)
    )
  );

drop policy if exists "Owners can upload LOCKD listing photos" on storage.objects;
create policy "Owners can upload LOCKD listing photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'lockd-listings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Owners can update LOCKD listing photos" on storage.objects;
create policy "Owners can update LOCKD listing photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'lockd-listings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'lockd-listings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Owners can delete LOCKD listing photos" on storage.objects;
create policy "Owners can delete LOCKD listing photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'lockd-listings' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.create_lockd_listing(
  p_listing jsonb,
  p_availability jsonb default '{}'::jsonb,
  p_publish boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
  v_saved_id uuid;
  v_slug text;
  v_title text;
  v_category text;
  v_description text;
  v_location text;
  v_price numeric(12,2);
  v_deposit numeric(12,2);
  v_price_unit text;
  v_images jsonb;
  v_attributes jsonb;
  v_start date;
  v_end date;
  v_units integer;
  v_min_days integer;
  v_market_category text;
begin
  if v_owner is null then
    raise exception using message = 'Sign in to manage your listings.';
  end if;
  if jsonb_typeof(p_listing) <> 'object' or jsonb_typeof(coalesce(p_availability, '{}'::jsonb)) <> 'object' then
    raise exception using message = 'Add a valid title and location.';
  end if;

  begin
    v_id := nullif(p_listing->>'id', '')::uuid;
  exception when others then
    v_id := null;
  end;
  if v_id is null then v_id := gen_random_uuid(); end if;

  v_slug := lower(coalesce(p_listing->>'slug', ''));
  v_title := trim(coalesce(p_listing->>'title', ''));
  v_category := p_listing->>'category';
  v_description := trim(coalesce(p_listing->>'description', ''));
  v_location := trim(coalesce(p_listing->>'location_label', ''));
  v_images := coalesce(p_listing->'images', '[]'::jsonb);
  v_attributes := coalesce(p_listing->'attributes', '{}'::jsonb);

  if v_category is null or v_category not in ('stay', 'drive', 'play', 'technology', 'experience', 'camera', 'phone', 'laptop', 'audio', 'creative', 'other') then
    raise exception using message = 'Choose a supported category.';
  end if;
  if length(v_title) not between 2 and 180 or length(v_location) not between 2 and 160
     or v_slug is null
     or v_slug !~ '^[a-z0-9][a-z0-9_-]{0,119}$' then
    raise exception using message = 'Add a valid title and location.';
  end if;
  if jsonb_typeof(v_attributes) <> 'object' or octet_length(v_attributes::text) > 12000 then
    raise exception using message = 'Complete the required details for this category.';
  end if;

  begin
    v_price := nullif(p_listing->>'price_amount', '')::numeric(12,2);
    v_deposit := nullif(p_listing->>'deposit_amount', '')::numeric(12,2);
    v_min_days := coalesce(nullif(p_listing->>'min_rental_days', '')::integer, 1);
  exception when others then
    raise exception using message = 'Set a valid rate in KES and choose its billing unit.';
  end;
  v_price_unit := nullif(p_listing->>'price_unit', '');
  if p_publish then
    if v_price is null or v_price <= 0 or coalesce(p_listing->>'currency', '') <> 'KES'
       or coalesce(v_price_unit, '') not in ('hour', 'day', 'night', 'week', 'month', 'trip') then
      raise exception using message = 'Set a valid rate in KES and choose its billing unit.';
    end if;
    if length(v_description) < 30 or length(v_description) > 5000 then
      raise exception using message = 'Add a description of at least 30 characters.';
    end if;
    if v_deposit is not null and v_deposit < 0 then
      raise exception using message = 'Choose a valid deposit amount.';
    end if;
    if jsonb_typeof(v_images) <> 'array' then
      raise exception using message = 'Add one to twelve successfully uploaded listing photos.';
    end if;
    if jsonb_array_length(v_images) not between 1 and 12 then
      raise exception using message = 'Add one to twelve successfully uploaded listing photos.';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_images) as photos(image_path)
      where image_path !~ ('^' || v_owner::text || '/' || v_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
         or not exists (
           select 1 from storage.objects object_row
           where object_row.bucket_id = 'lockd-listings'
              and object_row.name = image_path
         )
    ) then
      raise exception using message = 'Add one to twelve successfully uploaded listing photos.';
    end if;
    if v_min_days < 1 or v_min_days > 90 then
      raise exception using message = 'Choose a valid availability range.';
    end if;

    if v_category = 'stay' and (
      coalesce(p_listing->'attributes'->>'property_type', '') not in ('hotel', 'guesthouse', 'apartment', 'holiday_home', 'lodge', 'hostel')
      or coalesce(p_listing->'attributes'->>'room_type', '') not in ('entire_place', 'private_room', 'shared_room', 'hotel_room')
      or coalesce((case when p_listing->'attributes'->>'max_guests' ~ '^\d+$' then p_listing->'attributes'->>'max_guests' end)::integer, 0) not between 1 and 30
      or coalesce(p_listing->'attributes'->>'price_basis', '') not in ('per_room_per_night', 'per_property_per_night')
    ) then
      raise exception using message = 'Complete the required details for this category.';
    end if;
    if v_category = 'drive' and (
      length(trim(coalesce(p_listing->'attributes'->>'brand', ''))) < 1
      or length(trim(coalesce(p_listing->'attributes'->>'model', ''))) < 1
      or coalesce((case when p_listing->'attributes'->>'seating_capacity' ~ '^\d+$' then p_listing->'attributes'->>'seating_capacity' end)::integer, 0) not between 1 and 40
      or coalesce(p_listing->'attributes'->>'vehicle_type', '') not in ('car', 'suv', 'sedan', 'coupe', 'hatchback', 'van', 'pickup', 'motorcycle', '4x4', 'other')
      or coalesce(p_listing->'attributes'->>'transmission', '') not in ('automatic', 'manual')
      or coalesce(p_listing->'attributes'->>'fuel_type', '') not in ('petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'other')
      or coalesce(p_listing->'attributes'->>'service_mode', '') not in ('self_drive', 'chauffeur', 'both')
      or coalesce(p_listing->'attributes'->>'cancellation_policy', '') not in ('flexible', 'moderate', 'strict')
      or (
        p_listing->'attributes'->>'service_mode' in ('self_drive', 'both')
        and coalesce((case when p_listing->'attributes'->>'minimum_driver_age' ~ '^\d+$' then p_listing->'attributes'->>'minimum_driver_age' end)::integer, 0) not between 18 and 100
      )
    ) then
      raise exception using message = 'Complete the required details for this category.';
    end if;
    if v_category in ('technology', 'play', 'camera', 'phone', 'laptop', 'audio', 'creative') and (
      length(trim(coalesce(p_listing->'attributes'->>'brand', ''))) < 1
      or length(trim(coalesce(p_listing->'attributes'->>'model', ''))) < 1
      or coalesce(p_listing->'attributes'->>'condition', '') not in ('new', 'excellent', 'good', 'fair', 'refurbished')
    ) then
      raise exception using message = 'Complete the required details for this category.';
    end if;
    if v_category = 'experience' and (
      length(trim(coalesce(p_listing->'attributes'->>'duration', ''))) < 1
      or coalesce((case when p_listing->'attributes'->>'capacity' ~ '^\d+$' then p_listing->'attributes'->>'capacity' end)::integer, 0) not between 1 and 100
    ) then
      raise exception using message = 'Complete the required details for this category.';
    end if;

    if coalesce(p_availability->>'startDate', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(p_availability->>'endDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception using message = 'Add a future availability range with at least one available unit.';
    end if;
    v_start := (p_availability->>'startDate')::date;
    v_end := (p_availability->>'endDate')::date;
    begin
      v_units := (p_availability->>'units')::integer;
    exception when others then
      v_units := 0;
    end;
    if v_start < current_date or v_end <= v_start or v_end - v_start > 366 or v_units not between 1 and 20 then
      raise exception using message = 'Add a future availability range with at least one available unit.';
    end if;
  else
    if v_price is not null and (v_price <= 0 or coalesce(p_listing->>'currency', '') <> 'KES'
       or coalesce(v_price_unit, '') not in ('hour', 'day', 'night', 'week', 'month', 'trip')) then
      raise exception using message = 'Set a valid rate in KES and choose its billing unit.';
    end if;
    if v_deposit is not null and v_deposit < 0 then
      raise exception using message = 'Choose a valid deposit amount.';
    end if;
  end if;

  v_market_category := case v_category
    when 'play' then 'gaming'
    when 'phone' then 'phones'
    when 'laptop' then 'computers'
    when 'camera' then 'creator'
    when 'creative' then 'creator'
    when 'audio' then 'audio'
    when 'other' then 'other'
    else null
  end;

  insert into public.lockd_listings (
    id, owner_id, slug, title, category, market_category, summary, description,
    images, image_alt, location_label, price_amount, currency, price_unit,
    deposit_amount, deposit_currency, rental_durations, collection_available,
    delivery_available, attributes, requires_approval, checkout_enabled,
    min_rental_days, listing_status, approval_status, updated_at
  ) values (
    v_id, v_owner, v_slug, v_title, v_category, v_market_category,
    nullif(trim(coalesce(p_listing->>'summary', '')), ''), nullif(v_description, ''),
    v_images, nullif(trim(coalesce(p_listing->>'image_alt', '')), ''), v_location,
    v_price, case when v_price is null then null else 'KES' end, v_price_unit,
    v_deposit, case when v_deposit is null then null else 'KES' end,
    case when v_price_unit is null then '{}'::text[] else array[v_price_unit] end,
    coalesce((p_listing->>'collection_available')::boolean, false),
    coalesce((p_listing->>'delivery_available')::boolean, false), v_attributes,
    true, false, greatest(1, least(v_min_days, 90)),
    case when p_publish then 'published' else 'draft' end,
    case when p_publish then 'approved' else 'pending' end,
    now()
  )
  on conflict (id) do update set
    slug = excluded.slug, title = excluded.title, category = excluded.category,
    market_category = excluded.market_category, summary = excluded.summary,
    description = excluded.description, images = excluded.images,
    image_alt = excluded.image_alt, location_label = excluded.location_label,
    price_amount = excluded.price_amount, currency = excluded.currency,
    price_unit = excluded.price_unit, deposit_amount = excluded.deposit_amount,
    deposit_currency = excluded.deposit_currency, rental_durations = excluded.rental_durations,
    collection_available = excluded.collection_available, delivery_available = excluded.delivery_available,
    attributes = excluded.attributes, requires_approval = true, checkout_enabled = false,
    min_rental_days = excluded.min_rental_days, listing_status = excluded.listing_status,
    approval_status = excluded.approval_status, updated_at = now()
  where public.lockd_listings.owner_id = v_owner
    and public.lockd_listings.listing_status not in ('suspended', 'rejected');

  if not found then
    raise exception using message = 'This listing is unavailable or cannot be changed.';
  end if;
  v_saved_id := v_id;

  if p_publish then
    delete from public.lockd_listing_availability where listing_id = v_saved_id;
    insert into public.lockd_listing_availability (listing_id, calendar_date, available_units)
      select v_saved_id, day_value::date, v_units
      from generate_series(v_start, v_end - 1, interval '1 day') as days(day_value)
      on conflict (listing_id, calendar_date) do update set
        available_units = excluded.available_units, updated_at = now();
  end if;

  return jsonb_build_object(
    'id', v_saved_id,
    'slug', v_slug,
    'listing_status', case when p_publish then 'published' else 'draft' end,
    'approval_status', case when p_publish then 'approved' else 'pending' end
  );
end;
$$;

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

create or replace function public.set_my_lockd_listing_status(p_listing_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing public.lockd_listings%rowtype;
begin
  if auth.uid() is null then raise exception using message = 'Sign in to manage your listings.'; end if;
  if p_listing_id is null or p_status is null or p_status not in ('published', 'paused', 'archived') then
    raise exception using message = 'Choose a valid listing and status.';
  end if;
  update public.lockd_listings
    set listing_status = p_status,
        approval_status = case when p_status = 'published' then 'approved' else approval_status end,
        updated_at = now()
    where id = p_listing_id and owner_id = auth.uid()
      and listing_status not in ('suspended', 'rejected', 'pending_review', 'needs_changes')
    returning * into v_listing;
  if not found then raise exception using message = 'This listing is unavailable or cannot be changed.'; end if;
  return jsonb_build_object('id', v_listing.id, 'slug', v_listing.slug, 'listing_status', v_listing.listing_status);
end;
$$;

revoke all on function public.create_lockd_listing(jsonb, jsonb, boolean) from public, anon;
revoke all on function public.my_lockd_listings() from public, anon;
revoke all on function public.set_my_lockd_listing_status(uuid, text) from public, anon;
grant execute on function public.create_lockd_listing(jsonb, jsonb, boolean) to authenticated;
grant execute on function public.my_lockd_listings() to authenticated;
grant execute on function public.set_my_lockd_listing_status(uuid, text) to authenticated;

-- Restore existing source: 20261028_0005_lockd_unified_search.sql
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

-- Restore existing source: 20261028_0006_lockd_discovery_feed.sql
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

notify pgrst, 'reload schema';
commit;
