-- Persistent LOCKD customer accounts, saved listings, preferences and deletion requests.
-- Identity remains Supabase Auth's auth.users; this migration adds only user-owned data.

create table if not exists public.lockd_user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 100),
  avatar_url text check (avatar_url is null or length(avatar_url) <= 2048),
  preferred_currency text not null default 'KES' check (preferred_currency ~ '^[A-Z]{3}$'),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'sw')),
  discovery_location text check (discovery_location is null or length(discovery_location) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lockd_user_profiles enable row level security;
revoke all on public.lockd_user_profiles from anon, authenticated;
grant select on public.lockd_user_profiles to authenticated;
grant insert (user_id, display_name, avatar_url, preferred_currency, preferred_language, discovery_location)
  on public.lockd_user_profiles to authenticated;
grant update (display_name, avatar_url, preferred_currency, preferred_language, discovery_location)
  on public.lockd_user_profiles to authenticated;

drop policy if exists "Users can read their LOCKD profile" on public.lockd_user_profiles;
create policy "Users can read their LOCKD profile"
  on public.lockd_user_profiles for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can create their LOCKD profile" on public.lockd_user_profiles;
create policy "Users can create their LOCKD profile"
  on public.lockd_user_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their LOCKD profile" on public.lockd_user_profiles;
create policy "Users can update their LOCKD profile"
  on public.lockd_user_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.lockd_update_profile_timestamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lockd_user_profiles_set_updated_at on public.lockd_user_profiles;
create trigger lockd_user_profiles_set_updated_at
  before update on public.lockd_user_profiles
  for each row execute function public.lockd_update_profile_timestamp();
revoke all on function public.lockd_update_profile_timestamp() from public, anon, authenticated;

create or replace function public.lockd_create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.lockd_user_profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 100), ''),
    nullif(left(coalesce(new.raw_user_meta_data->>'avatar_url', ''), 2048), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.lockd_create_profile_for_new_user() from public, anon, authenticated;
drop trigger if exists lockd_create_profile_after_auth_insert on auth.users;
create trigger lockd_create_profile_after_auth_insert
  after insert on auth.users
  for each row execute function public.lockd_create_profile_for_new_user();

create table if not exists public.lockd_saved_listings (
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_id uuid not null references public.lockd_listings (id) on delete restrict,
  listing_snapshot jsonb not null check (jsonb_typeof(listing_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists lockd_saved_listings_user_created_idx
  on public.lockd_saved_listings (user_id, created_at desc);

alter table public.lockd_saved_listings enable row level security;
revoke all on public.lockd_saved_listings from anon, authenticated;
grant select, delete on public.lockd_saved_listings to authenticated;

drop policy if exists "Users can read their saved LOCKD listings" on public.lockd_saved_listings;
create policy "Users can read their saved LOCKD listings"
  on public.lockd_saved_listings for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can remove their saved LOCKD listings" on public.lockd_saved_listings;
create policy "Users can remove their saved LOCKD listings"
  on public.lockd_saved_listings for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.save_lockd_listing(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_listing public.lockd_listings%rowtype;
begin
  if v_user_id is null then
    raise exception using message = 'Sign in to save a listing.';
  end if;
  if p_listing_id is null then
    raise exception using message = 'Choose a valid published listing.';
  end if;

  select * into v_listing
  from public.lockd_listings
  where id = p_listing_id
    and listing_status = 'published'
    and approval_status = 'approved';
  if not found then
    raise exception using message = 'This listing is no longer available to save.';
  end if;

  insert into public.lockd_saved_listings (user_id, listing_id, listing_snapshot)
  values (
    v_user_id,
    v_listing.id,
    jsonb_build_object(
      'id', v_listing.id,
      'slug', v_listing.slug,
      'title', v_listing.title,
      'category', v_listing.category,
      'location_label', v_listing.location_label,
      'images', v_listing.images,
      'price_amount', v_listing.price_amount,
      'currency', v_listing.currency,
      'price_unit', v_listing.price_unit
    )
  )
  on conflict (user_id, listing_id) do update
    set listing_snapshot = excluded.listing_snapshot;
  return true;
end;
$$;

create or replace function public.remove_lockd_saved_listing(p_listing_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using message = 'Sign in to manage saved listings.';
  end if;
  delete from public.lockd_saved_listings
  where user_id = v_user_id and listing_id = p_listing_id;
  return found;
end;
$$;

revoke all on function public.save_lockd_listing(uuid) from public, anon;
revoke all on function public.remove_lockd_saved_listing(uuid) from public, anon;
grant execute on function public.save_lockd_listing(uuid) to authenticated;
grant execute on function public.remove_lockd_saved_listing(uuid) to authenticated;

create table if not exists public.lockd_account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  reason text check (reason is null or length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'rejected')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists lockd_account_deletion_requests_user_idx
  on public.lockd_account_deletion_requests (user_id, created_at desc);

create unique index if not exists lockd_one_open_deletion_request_per_user_idx
  on public.lockd_account_deletion_requests (user_id)
  where user_id is not null and status in ('pending', 'processing');

alter table public.lockd_account_deletion_requests enable row level security;
revoke all on public.lockd_account_deletion_requests from anon, authenticated;
grant select on public.lockd_account_deletion_requests to authenticated;
grant insert (user_id, reason) on public.lockd_account_deletion_requests to authenticated;
grant update (status, processed_at) on public.lockd_account_deletion_requests to authenticated;

drop policy if exists "Users can read their LOCKD deletion requests" on public.lockd_account_deletion_requests;
create policy "Users can read their LOCKD deletion requests"
  on public.lockd_account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()) or (auth.jwt()->'app_metadata'->>'role') = 'admin');

drop policy if exists "Users can submit LOCKD deletion requests" on public.lockd_account_deletion_requests;
create policy "Users can submit LOCKD deletion requests"
  on public.lockd_account_deletion_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and processed_at is null);

drop policy if exists "LOCKD admins can process deletion requests" on public.lockd_account_deletion_requests;
create policy "LOCKD admins can process deletion requests"
  on public.lockd_account_deletion_requests for update to authenticated
  using ((auth.jwt()->'app_metadata'->>'role') = 'admin')
  with check ((auth.jwt()->'app_metadata'->>'role') = 'admin');
