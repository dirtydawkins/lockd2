# Supabase catalogue setup

The catalogue reads only approved, published rows from `public.lockd_listings`. The SQL migration is namespaced and additive; it does not seed sample rentals or modify existing tables. Public roles receive column-level access to listing fields only; owner IDs and update metadata are not granted.

## Apply the migration

1. Open the Supabase project that will serve LOCKD and review the migration before applying it.
2. Run `supabase/migrations/20261028_0001_lockd_catalogue.sql` in the project's SQL editor or with the Supabase CLI.
3. Then run `supabase/migrations/20261028_0002_lockd_tech_discovery.sql`. This adds listing terms, date-filtered search, benchmark records and admin-role policies. It seeds sourced market references only; it does not create LOCKD rentals.
4. Add actual rental records only after the owner, listing details, images, price, currency, pricing unit, and publication approval have been verified. For technology listings, set `market_category` to the matching group and store actual brand, model, configuration, condition, included accessories and use cases in `attributes`.
5. Add one availability row for each date that has confirmed capacity. A date without a row is treated as unavailable. Only confirmed bookings reduce that capacity.

The migrations intentionally create no rental inventory records. Market-price benchmark rows are references to other providers and cannot enter LOCKD's booking flow. The included user-supplied photographs are editorial illustrations; their exact product model, availability and third-party rights have not been independently verified. See `TECH_ASSET_MANIFEST.json`.

## Technology benchmark editing

`public.lockd_market_price_benchmarks` keeps provider prices separate from owner-configured listing prices. Public users can read only rows marked `published`; anonymous users cannot create or change them. An authenticated user must have the server-managed JWT `app_metadata.role = "admin"` to edit or publish benchmark rows. Apply roles only through a trusted administrative process.

There is no LOCKD administrator web console yet. Authorized administrators can manage records in the Supabase dashboard or SQL editor. The API reads public database benchmark rows when available; otherwise it serves the source-linked snapshot in `data/tech-market-benchmarks.json`. Do not edit that file to represent an actual LOCKD rental.

## Vercel environment variables

Add these variables to the Vercel project connected to this repository, then redeploy:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` | The HTTPS URL for the Supabase project. |
| `SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The public anon key. RLS remains the access boundary. The serverless API accepts either naming convention. |
| `LOCKD_SUPPORT_EMAIL` | Optional LOCKD contact email used to create contextual owner-approval enquiries. |

The catalogue endpoints use only the anon key. Do not add a service-role key, database password, payment secret, or OAuth client secret to browser code or these variables.

## Current boundaries

- `GET /api/listings` returns only rows where `listing_status = 'published'` and `approval_status = 'approved'`.
- `GET /api/listings?market=tech` can filter published technology inventory by brand, product type, condition, location, price range, rental duration, included accessory, collection/delivery, tagged use case and dates. Listings must contain owner-confirmed attributes for these filters to be useful.
- `GET /api/benchmarks` serves published, read-only provider references or the checked-in research snapshot. These records do not have booking identifiers or availability.
- `POST /api/availability` calls the database function, which checks every date, configured unit capacity, and confirmed booking overlap.
- Date filtering uses `search_lockd_available_listings`, which returns IDs only. It remains a read-only availability check and does not hold inventory.
- `/sitemap.xml` is rewritten to a public sitemap handler. It lists the public pages and, when Supabase responds, only published and approved rental slugs.
- A date check is not a booking hold or confirmation.
- LOCKD currently has no configured checkout, payment, cancellation, owner approval, notification, or payout API. The UI therefore does not show `Reserve Now` or `Secure My Booking`.
- `checkout_enabled` is a schema field for future use; it does not activate checkout.
- Owner and administrator write paths must be added with authenticated server-side authorization before accepting submissions or approvals.
- Favorites, saved searches, recent views and comparisons on the technology page are device-local because customer account authentication is not implemented. They do not sync across browsers or sign-in.
