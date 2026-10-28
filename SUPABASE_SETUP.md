# Supabase catalogue setup

The catalogue reads only approved, published rows from `public.lockd_listings`. The SQL migration is namespaced and additive; it does not seed sample rentals or modify existing tables. Public roles receive column-level access to listing fields only; owner IDs and update metadata are not granted.

## Apply the migration

1. Open the Supabase project that will serve LOCKD and review the migration before applying it.
2. Run `supabase/migrations/20261028_0001_lockd_catalogue.sql` in the project's SQL editor or with the Supabase CLI.
3. Run `supabase/migrations/20261028_0002_lockd_tech_discovery.sql` if it has not already been applied. This adds listing terms and technology filters.
4. Run `supabase/migrations/20261028_0003_lockd_private_research.sql` to restrict internal market research to authenticated LOCKD administrators.
5. Add actual rental records only after the owner, listing details, images, price, currency, pricing unit, and publication approval have been verified. For technology listings, set `market_category` to the matching group and store actual brand, model, configuration, condition, included accessories and use cases in `attributes`.
6. Add one availability row for each date that has confirmed capacity. A date without a row is treated as unavailable. Only confirmed bookings reduce that capacity.

Migrations 0001 and 0002 were applied to the connected Supabase project from the SQL Editor on 2026-10-28. Migration 0003 is new and must be applied before deployment to remove anonymous access to existing research rows. Because previous migrations were run directly in the SQL Editor, they may not appear in the Supabase CLI migration history. Inspect the live schema before re-running them; establish a tracked migration baseline before adding future migrations.

The migrations intentionally create no rental inventory records. Internal market research is separate from owner-configured listing prices and cannot enter LOCKD's booking flow. The included user-supplied photographs are editorial illustrations; their availability and third-party rights have not been independently verified.

## Internal market research access

`public.lockd_market_price_benchmarks` keeps internal provider research separate from owner-configured listing prices. After migration 0003, only an authenticated user with the server-managed JWT `app_metadata.role = "admin"` can read or change these records. Apply roles only through a trusted administrative process.

There is no LOCKD administrator web console yet. Authorized administrators can manage records in the Supabase dashboard or SQL editor. Internal research is not served by a public API or static file and must never be represented as an actual LOCKD rental.

## Vercel environment variables

Add these variables to the Vercel project connected to this repository, then redeploy:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` | The HTTPS URL for the Supabase project. |
| `SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Recommended Supabase publishable key (`sb_publishable_…`). RLS and grants remain the access boundary. |
| `SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy public anon key for existing Supabase projects. |
| `LOCKD_SUPPORT_EMAIL` | Optional LOCKD contact email used to create contextual owner-approval enquiries. |

The catalogue endpoints accept only the publishable key or legacy anon key. They reject Supabase secret/service-role keys. Do not add a database password, payment secret, or OAuth client secret to browser code or these variables. After adding or changing Vercel environment variables, create a new production deployment for the function runtime to receive them.

## Current boundaries

- `GET /api/listings` returns only rows where `listing_status = 'published'` and `approval_status = 'approved'`.
- `GET /api/listings?market=tech` can filter published technology inventory by brand, product type, condition, location, price range, rental duration, included accessory, collection/delivery, tagged use case and dates. Listings must contain owner-confirmed attributes for these filters to be useful.
- `GET /api/listings?category=stay` searches only approved accommodation records. Guest capacity and amenities are listing attributes; selected dates and requested room quantity use the server-side calendar search.
- `POST /api/availability` calls the database function, which checks every date, configured unit capacity, and confirmed booking overlap.
- Date filtering uses `search_lockd_available_listings`, which returns IDs only. It remains a read-only availability check and does not hold inventory.
- `/sitemap.xml` is rewritten to a public sitemap handler. It lists the public pages and, when Supabase responds, only published and approved rental slugs.
- A date check is not a booking hold or confirmation.
- LOCKD currently has no configured checkout, payment, cancellation, owner approval, notification, or payout API. The UI therefore does not show `Reserve Now` or `Secure My Booking`.
- `checkout_enabled` is a schema field for future use; it does not activate checkout.
- Owner and administrator write paths must be added with authenticated server-side authorization before accepting submissions or approvals.
- Favorites, saved searches, recent views and comparisons on the technology page are device-local because customer account authentication is not implemented. They do not sync across browsers or sign-in.
