-- Additive technology catalogue fields, sourced market references, and date-aware search.
-- Provider benchmarks are independent records; they never create owner listings or bookings.

alter table public.lockd_listings
  add column if not exists market_category text check (market_category is null or market_category in (
    'gaming', 'phones', 'computers', 'creator', 'audio', 'work', 'accessories', 'other'
  )),
  add column if not exists deposit_amount numeric(12, 2) check (deposit_amount is null or deposit_amount >= 0),
  add column if not exists deposit_currency text check (deposit_currency is null or deposit_currency ~ '^[A-Z]{3}$'),
  add column if not exists rental_durations text[] not null default '{}',
  add column if not exists collection_available boolean,
  add column if not exists delivery_available boolean,
  add column if not exists image_rights_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lockd_listings_deposit_currency_pair'
      and conrelid = 'public.lockd_listings'::regclass
  ) then
    alter table public.lockd_listings
      add constraint lockd_listings_deposit_currency_pair check (
        (deposit_amount is null) = (deposit_currency is null)
      );
  end if;
end;
$$;

grant select (
  market_category, deposit_amount, deposit_currency, rental_durations, collection_available, delivery_available
) on public.lockd_listings to anon, authenticated;

create index if not exists lockd_listings_market_category_idx
  on public.lockd_listings (market_category, created_at desc)
  where listing_status = 'published' and approval_status = 'approved';

create table if not exists public.lockd_market_price_benchmarks (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,119}$'),
  product_category text not null check (product_category in (
    'gaming', 'phone', 'computer', 'camera_creator', 'audio', 'drone', 'projector', 'event_gear'
  )),
  product_name text not null check (length(trim(product_name)) between 2 and 180),
  provider_name text not null check (length(trim(provider_name)) between 2 and 160),
  source_url text not null check (source_url ~ '^https://'),
  displayed_price numeric(12, 2) not null check (displayed_price > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  billing_unit text not null check (billing_unit in ('hour', 'day', 'night', 'week', 'month', 'trip')),
  research_date date not null,
  service_area text,
  included_equipment text,
  mandatory_fees text,
  availability_note text,
  limitations text,
  source_type text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden', 'stale')),
  admin_notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lockd_market_benchmarks_public_idx
  on public.lockd_market_price_benchmarks (product_category, research_date desc)
  where status = 'published';

create or replace function public.touch_lockd_market_benchmark_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lockd_market_benchmark_updated_at on public.lockd_market_price_benchmarks;
create trigger lockd_market_benchmark_updated_at
  before update on public.lockd_market_price_benchmarks
  for each row execute function public.touch_lockd_market_benchmark_updated_at();

alter table public.lockd_market_price_benchmarks enable row level security;
revoke all on public.lockd_market_price_benchmarks from anon, authenticated;
grant select (
  id, product_category, product_name, provider_name, source_url, displayed_price, currency,
  billing_unit, research_date, service_area, included_equipment, mandatory_fees,
  availability_note, limitations, source_type, status
) on public.lockd_market_price_benchmarks to anon, authenticated;
grant insert, update, delete on public.lockd_market_price_benchmarks to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'lockd_market_price_benchmarks'
      and policyname = 'Public can read published LOCKD market benchmarks'
  ) then
    create policy "Public can read published LOCKD market benchmarks"
      on public.lockd_market_price_benchmarks for select to anon, authenticated
      using (status = 'published');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'lockd_market_price_benchmarks'
      and policyname = 'LOCKD admins manage market benchmarks'
  ) then
    create policy "LOCKD admins manage market benchmarks"
      on public.lockd_market_price_benchmarks for all to authenticated
      using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
      with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
  end if;
end;
$$;

insert into public.lockd_market_price_benchmarks (
  id, product_category, product_name, provider_name, source_url, displayed_price,
  currency, billing_unit, research_date, service_area, included_equipment,
  mandatory_fees, availability_note, limitations, source_type, status
) values
  ('flexi-ps5-slim-day-20261028','gaming','PlayStation 5 Slim','Flexi Gear','https://flexigear.co.ke/',5500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; confirm console edition, included controllers and games, deposit, delivery and current rate directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-ps4-slim-day-20261028','gaming','PlayStation 4 Slim','Flexi Gear','https://flexigear.co.ke/',2500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; confirm console edition, included controllers and games, deposit, delivery and current rate directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-quest3s-day-20261028','gaming','Meta Quest 3S','Flexi Gear','https://flexigear.co.ke/product/meta-quest-3s/',4500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the product page rate section.','Not stated on the product page rate section.','Specific dates and stock not checked.','Confirm headset storage, accessories, hygiene process, deposit and delivery directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider product page','published'),
  ('flexi-quest3-day-20261028','gaming','Meta Quest 3','Flexi Gear','https://flexigear.co.ke/',5500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; confirm headset storage, accessories, deposit and delivery directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-macbook-m2-day-20261028','computer','Apple MacBook Pro (M2, 2022)','Flexi Gear','https://flexigear.co.ke/product/macbook-pro-m2-2022/',3000,'KES','day','2026-10-28','Kenya; delivery and collection described for Nairobi and surrounding areas','The provider page says the original USB-C power adapter and charging cable are included.','Full payment before release is stated in the provider FAQ; no deposit amount listed.','Specific dates and stock not checked; provider says to confirm current stock.','RAM, storage, screen size and exact included accessories are not specified in the rate section. Confirm the supplied configuration and current price. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider product page','published'),
  ('flexi-lenovo-i5-day-20261028','computer','Lenovo Core i5 laptop (6th or 7th generation)','Flexi Gear','https://flexigear.co.ke/product/lenovo-intel-core-i5-6th-7th-generation-laptop/',1000,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified in the rate section.','Not stated on the product page rate section.','Specific dates and stock not checked.','Provider describes the listed models as 6th/7th generation and refurbished, but the exact unit configuration varies; confirm RAM, SSD, model, condition, accessories and current rate. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider product page','published'),
  ('flexi-hp-i5-day-20261028','computer','HP Core i5 laptop (6th or 7th generation)','Flexi Gear','https://flexigear.co.ke/',1000,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; exact model, generation, memory, storage, condition and included accessories require confirmation. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-dell-i5-day-20261028','computer','Dell Core i5 laptop (6th or 7th generation)','Flexi Gear','https://flexigear.co.ke/',1000,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; exact model, generation, memory, storage, condition and included accessories require confirmation. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-tablet-a11-day-20261028','computer','Samsung Galaxy Tab A11','Flexi Gear','https://flexigear.co.ke/',2000,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; confirm storage, connectivity variant, accessories, deposit and current rate. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-drone-mini4k-day-20261028','drone','DJI Mini 4K drone','Flexi Gear','https://flexigear.co.ke/',10500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Standard catalogue entry; exact batteries and accessories not specified.','Not stated in the catalogue result.','Specific dates and stock not checked.','Confirm exact package, batteries, controller, insurance, operating permissions and current rate. No regulatory status independently verified. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-drone-mini4k-flymore-day-20261028','drone','DJI Mini 4K Fly More Combo','Flexi Gear','https://flexigear.co.ke/',14500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Fly More Combo as named by provider; exact contents not independently checked.','Not stated in the catalogue result.','Specific dates and stock not checked.','Confirm exact package contents, insurance, operating permissions and current rate. No regulatory status independently verified. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-speaker-jbl-720-day-20261028','audio','JBL PartyBox 720','Flexi Gear','https://flexigear.co.ke/',6500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; confirm microphone/accessories, delivery, deposit and current rate directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-speaker-jbl-520-day-20261028','audio','JBL PartyBox 520','Flexi Gear','https://flexigear.co.ke/',5500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Not specified on the catalogue result.','Not stated in the catalogue result.','Specific dates and stock not checked.','Catalogue-level rate; confirm microphone/accessories, delivery, deposit and current rate directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-speaker-jbl-stage320-day-20261028','audio','JBL PartyBox Stage 320','Flexi Gear','https://flexigear.co.ke/product/jbl-partybox-stage-320/',5000,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Exact hire accessories not specified in the rate section.','Not stated in the product-page rate section.','Specific dates and stock not checked.','Confirm microphone, delivery, deposit and current rate directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider product page','published'),
  ('flexi-speaker-jbl-onthego-day-20261028','audio','JBL PartyBox On-The-Go 2','Flexi Gear','https://flexigear.co.ke/product/jbl-partybox-on-the-go-2/',5000,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','The product description mentions a wireless microphone; confirm the exact supplied set.','Not stated in the product-page rate section.','Specific dates and stock not checked.','Confirm exact generation, accessories, delivery, deposit and current rate directly. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider product page','published'),
  ('flexi-drone-mini3-day-20261028','drone','DJI Mini 3 with DJI RC remote','Flexi Gear','https://flexigear.co.ke/',16500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','DJI RC remote as named in the catalogue; remaining accessories not specified.','Not stated in the catalogue result.','Specific dates and stock not checked.','Confirm exact package, batteries, insurance, operating permissions and current rate. No regulatory status independently verified. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('flexi-drone-mini3-flymore-day-20261028','drone','DJI Mini 3 with DJI RC Fly More Combo','Flexi Gear','https://flexigear.co.ke/',20500,'KES','day','2026-10-28','Kenya (provider lists Nairobi shop)','Fly More Combo and DJI RC as named by the catalogue; exact contents not independently checked.','Not stated in the catalogue result.','Specific dates and stock not checked.','Confirm exact package, insurance, operating permissions and current rate. No regulatory status independently verified. The provider result was indexed earlier (roughly three weeks to two months before this research), and current rates were not independently reconfirmed; confirm directly before relying on it.','Official provider catalogue','published'),
  ('cloudbackup-laptop-day-20261028','computer','Standard business laptop rental','Cloudbackup Solutions','https://cloudbackup.co.ke/laptop-rentals/',1300,'KES','day','2026-10-28','Nairobi; provider states service across Kenya','Provider describes business laptops configured to requested specifications; exact model and accessories depend on quote.','Provider states refundable security deposit is calculated from equipment value and rental duration; amount not published. Page states free delivery to office or venue in Nairobi.','Specific dates and stock not checked.','The displayed daily rate is an average/reference for standard business laptops, not a guaranteed price for a particular configuration. Confirm specifications and quote.','Official provider rental-rate page','published'),
  ('cloudbackup-laptop-week-20261028','computer','Standard business laptop rental','Cloudbackup Solutions','https://cloudbackup.co.ke/laptop-rentals/',4500,'KES','week','2026-10-28','Nairobi; provider states service across Kenya','Provider describes business laptops configured to requested specifications; exact model and accessories depend on quote.','Provider states refundable security deposit is calculated from equipment value and rental duration; amount not published. Page states free delivery to office or venue in Nairobi.','Specific dates and stock not checked.','Weekly price is shown separately from the daily rate; no daily-to-weekly conversion applied. Exact configuration requires a quote.','Official provider rental-rate page','published'),
  ('cloudbackup-laptop-month-20261028','computer','Standard business laptop rental','Cloudbackup Solutions','https://cloudbackup.co.ke/laptop-rentals/',10000,'KES','month','2026-10-28','Nairobi; provider states service across Kenya','Provider describes business laptops configured to requested specifications; exact model and accessories depend on quote.','Provider states refundable security deposit is calculated from equipment value and rental duration; amount not published. Page states free delivery to office or venue in Nairobi.','Specific dates and stock not checked.','Monthly price is shown separately from daily and weekly rates; no conversion or discount was calculated. Exact configuration requires a quote.','Official provider rental-rate page','published'),
  ('tarf-fx3-day-20261028','camera_creator','Sony FX3 Cinema Camera','Tarf Media','https://www.tarfmedia.co.ke/hire',6500,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Provider lists 4K 120fps, S-Cinetone, full-frame and compact body; no accessories stated for this item.','Tarf says a 10% discount is applied at its checkout. It also describes full payment or a 50% deposit to confirm; confirm terms directly.','Provider catalogue labels this item available; no customer dates were checked.','Rate is a market reference from Tarf only, not a LOCKD price. Confirm kit contents, delivery, deposit and current availability.','Official provider rental catalogue','published'),
  ('tarf-a7iv-day-20261028','camera_creator','Sony A7 IV full-frame camera','Tarf Media','https://www.tarfmedia.co.ke/hire',5000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','The catalogue says a kit lens is included; other accessories not stated.','Tarf says a 10% discount is applied at its checkout. It also describes full payment or a 50% deposit to confirm; confirm terms directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm exact kit lens, configuration, delivery, deposit and current availability.','Official provider rental catalogue','published'),
  ('tarf-a7iii-day-20261028','camera_creator','Sony A7 III mirrorless camera','Tarf Media','https://www.tarfmedia.co.ke/hire',4000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','The catalogue says a kit lens is included; other accessories not stated.','Tarf says a 10% discount is applied at its checkout. It also describes full payment or a 50% deposit to confirm; confirm terms directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm exact kit lens, configuration, delivery, deposit and current availability.','Official provider rental catalogue','published'),
  ('tarf-canon90d-day-20261028','camera_creator','Canon 90D DSLR','Tarf Media','https://www.tarfmedia.co.ke/hire',3000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','The catalogue says a kit lens is included.','Tarf says a 10% discount is applied at its checkout. It also describes full payment or a 50% deposit to confirm; confirm terms directly.','The provider page marked this product unavailable when checked.','Rate retained for market comparison only; it is explicitly marked unavailable by the provider and cannot be treated as available inventory.','Official provider rental catalogue','published'),
  ('tarf-canon80d-day-20261028','camera_creator','Canon 80D DSLR','Tarf Media','https://www.tarfmedia.co.ke/hire',2500,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','The catalogue says a kit lens is included.','Tarf says a 10% discount is applied at its checkout. It also describes full payment or a 50% deposit to confirm; confirm terms directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm exact kit lens, accessories, delivery, deposit and current availability.','Official provider rental catalogue','published'),
  ('tarf-nikon-d7500-day-20261028','camera_creator','Nikon D7500 DSLR','Tarf Media','https://www.tarfmedia.co.ke/hire',2500,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','The catalogue says a kit lens is included.','Tarf says a 10% discount is applied at its checkout. It also describes full payment or a 50% deposit to confirm; confirm terms directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm exact kit lens, accessories, delivery, deposit and current availability.','Official provider rental catalogue','published'),
  ('tarf-sony85-lens-day-20261028','camera_creator','Sony FE 85mm f/1.8 lens','Tarf Media','https://www.tarfmedia.co.ke/hire',1500,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Lens only as named; camera body not included.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Compatibility depends on camera mount; confirm body compatibility, accessories and current availability.','Official provider rental catalogue','published'),
  ('tarf-sony70200-lens-day-20261028','camera_creator','Sony FE 70–200mm f/2.8 lens','Tarf Media','https://www.tarfmedia.co.ke/hire',2500,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Lens only as named; camera body not included.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Compatibility depends on camera mount; confirm body compatibility, accessories and current availability.','Official provider rental catalogue','published'),
  ('tarf-sony2870-lens-day-20261028','camera_creator','Sony FE 28–70mm f/3.5–5.6 lens','Tarf Media','https://www.tarfmedia.co.ke/hire',1500,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Lens only as named; camera body not included.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm body compatibility, accessories and current availability.','Official provider rental catalogue','published'),
  ('tarf-canon50-lens-day-20261028','camera_creator','Canon EF 50mm f/1.8 lens','Tarf Media','https://www.tarfmedia.co.ke/hire',1000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Lens only as named; camera body not included.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm EF mount compatibility, accessories and current availability.','Official provider rental catalogue','published'),
  ('tarf-rs4-day-20261028','camera_creator','DJI RS4 Combo gimbal','Tarf Media','https://www.tarfmedia.co.ke/hire',3000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Provider lists a 3-axis stabilizer and 4.5 kg payload; combo contents not enumerated.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm camera compatibility, exact combo contents, delivery and current availability.','Official provider rental catalogue','published'),
  ('tarf-amaran150c-day-20261028','camera_creator','Aputure Amaran 150C light','Tarf Media','https://www.tarfmedia.co.ke/hire',2000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Provider lists bi-colour, 54 W and Bowens mount; modifier/accessories not stated.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm included power supply, modifiers and current availability.','Official provider rental catalogue','published'),
  ('tarf-godoxsl150-day-20261028','camera_creator','Godox SL 150 III light','Tarf Media','https://www.tarfmedia.co.ke/hire',2000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Provider lists 150 W daylight LED and Bowens mount; modifier/accessories not stated.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm included power supply, modifiers and current availability.','Official provider rental catalogue','published'),
  ('tarf-larkmax-day-20261028','audio','Hollyland Lark Max Duo wireless microphones','Tarf Media','https://www.tarfmedia.co.ke/hire',1500,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Provider names the Duo kit; exact clip, case and adapter contents not detailed.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm connector compatibility, transmitters, accessories and current availability.','Official provider rental catalogue','published'),
  ('tarf-djimic2-day-20261028','audio','DJI Mic 2 wireless kit','Tarf Media','https://www.tarfmedia.co.ke/hire',2000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Provider lists dual transmitters and backup recorder; exact accessory bundle not specified.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm receiver, cables/adapters and current availability.','Official provider rental catalogue','published'),
  ('tarf-air2s-day-20261028','drone','DJI Air 2S drone','Tarf Media','https://www.tarfmedia.co.ke/hire',10000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Provider catalogue lists a 1-inch sensor and 5.4K; package contents not detailed.','Tarf says a 10% discount is applied at its checkout. It also describes full payment or a 50% deposit to confirm; confirm terms directly.','Provider catalogue labels this item available; no customer dates were checked.','The source advertises KCAA compliance; LOCKD has not independently verified legal status, operator requirements, package contents or permissions. Confirm directly before hire.','Official provider rental catalogue','published'),
  ('tarf-yolobox-day-20261028','audio','YoloLiv YoloBox Pro streaming encoder','Tarf Media','https://www.tarfmedia.co.ke/hire',5000,'KES','day','2026-10-28','Nairobi and across Kenya (provider states service area)','Streaming encoder as named; cables and accessories not specified.','Tarf says a 10% discount is applied at its checkout. Confirm any deposit or other charges directly.','Provider catalogue labels this item available; no customer dates were checked.','Confirm input/output compatibility, cables, subscription requirements and current availability.','Official provider rental catalogue','published'),
  ('rolim-projector-day-20261028','projector','Projector hire (model not named)','Rolim White Board Wholesalers','https://www.rolimwholesalers.co.ke/product/quality-projector-for-hire/',2200,'KES','day','2026-10-28','Nairobi; delivery charges depend on distance and weight','Provider says cables, remotes and instructions are supplied; optional screen and other add-ons are mentioned.','Delivery/shipping charges are extra and depend on distance and weight. Deposit not stated on the page.','Specific dates and stock not checked.','The page does not name the exact projector model. Its copy mentions Full HD or 4K without tying a resolution to a specific unit; confirm model, lumens, resolution and accessories before relying on the rate.','Official provider product page','published'),
  ('janeson-playstation-event-day-20261028','gaming','PlayStation event setup (PS4 or PS5; package varies)','Janeson','https://janeson.co.ke/product/play-stations-for-hire-in-nairobi/',7000,'KES','day','2026-10-28','Nairobi; provider describes delivery/setup and collection options','The page describes consoles, controllers, selected games and gaming accessories; exact station count varies.','The headline shows KSh 7,999/day, while the pricing section says from KSh 7,000. Delivery/setup and location may affect the final quote.','Specific dates and stock not checked.','The page gives conflicting starting/display prices and bundles PS4/PS5 event use; shown here as a quote-dependent event package, not a comparable standalone-console rate.','Official provider product page','published')
on conflict (id) do nothing;

create or replace function public.search_lockd_available_listings(
  p_start_date date,
  p_end_date date,
  p_quantity integer
)
returns table (listing_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer;
begin
  if p_start_date is null or p_end_date is null or p_end_date <= p_start_date
     or p_end_date - p_start_date > 366
     or p_start_date < current_date or p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    return;
  end if;

  v_days := p_end_date - p_start_date;

  return query
    select l.id
    from public.lockd_listings l
    where l.listing_status = 'published'
      and l.approval_status = 'approved'
      and v_days >= l.min_rental_days
      and (l.max_rental_days is null or v_days <= l.max_rental_days)
      and not exists (
        select 1
        from generate_series(0, v_days - 1) as offset_day(day_number)
        left join public.lockd_listing_availability a
          on a.listing_id = l.id
          and a.calendar_date = p_start_date + offset_day.day_number
        left join lateral (
          select coalesce(sum(b.quantity), 0)::integer as reserved_units
          from public.lockd_bookings b
          where b.listing_id = l.id
            and b.status = 'confirmed'
            and b.start_date <= p_start_date + offset_day.day_number
            and b.end_date > p_start_date + offset_day.day_number
        ) booked on true
        where a.available_units is null
          or a.available_units - booked.reserved_units < p_quantity
      );
end;
$$;

revoke all on function public.search_lockd_available_listings(date, date, integer) from public;
grant execute on function public.search_lockd_available_listings(date, date, integer) to anon, authenticated;
