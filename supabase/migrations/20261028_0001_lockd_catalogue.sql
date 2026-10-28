-- Additive LOCKD public catalogue and date availability foundation.
-- This migration creates namespaced tables and does not modify or delete existing data.

create table if not exists public.lockd_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{0,119}$'),
  title text not null check (length(trim(title)) between 2 and 180),
  category text not null check (category in (
    'stay', 'drive', 'play', 'technology', 'experience', 'camera', 'phone', 'laptop', 'audio', 'creative', 'other'
  )),
  summary text,
  description text,
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  image_alt text,
  location_label text,
  price_amount numeric(12, 2) check (price_amount is null or price_amount > 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  price_unit text check (price_unit is null or price_unit in ('hour', 'day', 'night', 'week', 'month', 'trip')),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  requires_approval boolean not null default true,
  checkout_enabled boolean not null default false,
  min_rental_days integer not null default 1 check (min_rental_days > 0),
  max_rental_days integer check (max_rental_days is null or max_rental_days >= min_rental_days),
  listing_status text not null default 'draft' check (listing_status in (
    'draft', 'pending_review', 'needs_changes', 'rejected', 'suspended', 'archived', 'published'
  )),
  approval_status text not null default 'pending' check (approval_status in (
    'pending', 'approved', 'needs_changes', 'rejected', 'suspended'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((price_amount is null) = (currency is null)),
  check ((price_amount is null) = (price_unit is null))
);

create index if not exists lockd_listings_public_category_idx
  on public.lockd_listings (category, created_at desc)
  where listing_status = 'published' and approval_status = 'approved';

create table if not exists public.lockd_listing_availability (
  listing_id uuid not null references public.lockd_listings (id) on delete cascade,
  calendar_date date not null,
  available_units integer not null default 0 check (available_units >= 0),
  updated_at timestamptz not null default now(),
  primary key (listing_id, calendar_date)
);

create table if not exists public.lockd_bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.lockd_listings (id) on delete restrict,
  customer_id uuid references auth.users (id) on delete set null,
  start_date date not null,
  end_date date not null,
  quantity integer not null check (quantity between 1 and 20),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);

create index if not exists lockd_bookings_listing_dates_idx
  on public.lockd_bookings (listing_id, start_date, end_date)
  where status = 'confirmed';

alter table public.lockd_listings enable row level security;
alter table public.lockd_listing_availability enable row level security;
alter table public.lockd_bookings enable row level security;

revoke select on public.lockd_listings from anon, authenticated;
grant select (
  id, slug, title, category, summary, description, images, image_alt,
  location_label, price_amount, currency, price_unit, attributes,
  requires_approval, checkout_enabled, listing_status, approval_status, created_at
) on public.lockd_listings to anon, authenticated;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lockd_listings'
      and policyname = 'Public can read published approved LOCKD listings'
  ) then
    create policy "Public can read published approved LOCKD listings"
      on public.lockd_listings for select to anon, authenticated
      using (listing_status = 'published' and approval_status = 'approved');
  end if;
end;
$$;

revoke all on public.lockd_listing_availability from anon, authenticated;
revoke all on public.lockd_bookings from anon, authenticated;

create or replace function public.check_lockd_listing_availability(
  p_listing_id uuid,
  p_start_date date,
  p_end_date date,
  p_quantity integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_listing public.lockd_listings%rowtype;
  v_day date;
  v_units integer;
  v_days integer;
begin
  if p_listing_id is null or p_start_date is null or p_end_date is null
     or p_end_date <= p_start_date or p_quantity is null or p_quantity < 1 or p_quantity > 20
     or p_start_date < current_date then
    return false;
  end if;

  select * into v_listing
    from public.lockd_listings
    where id = p_listing_id
      and listing_status = 'published'
      and approval_status = 'approved';
  if not found then return false; end if;

  v_days := p_end_date - p_start_date;
  if v_days < v_listing.min_rental_days
     or (v_listing.max_rental_days is not null and v_days > v_listing.max_rental_days) then
    return false;
  end if;

  for v_day in
    select p_start_date + day_offset
    from generate_series(0, v_days - 1) as days(day_offset)
  loop
    select a.available_units into v_units
      from public.lockd_listing_availability a
      where a.listing_id = p_listing_id and a.calendar_date = v_day;
    if not found then return false; end if;

    if v_units - coalesce((
      select sum(b.quantity)::integer
      from public.lockd_bookings b
      where b.listing_id = p_listing_id
        and b.status = 'confirmed'
        and b.start_date <= v_day
        and b.end_date > v_day
    ), 0) < p_quantity then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.check_lockd_listing_availability(uuid, date, date, integer) from public;
grant execute on function public.check_lockd_listing_availability(uuid, date, date, integer) to anon, authenticated;
