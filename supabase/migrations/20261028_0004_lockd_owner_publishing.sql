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
