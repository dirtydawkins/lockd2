# Supabase catalogue setup

The catalogue reads only approved, published rows from `public.lockd_listings`. The SQL migration is namespaced and additive; it does not seed sample rentals or modify existing tables. Public roles receive column-level access to listing fields only; owner IDs and update metadata are not granted.

## Apply the migration

1. Open the Supabase project that will serve LOCKD and review the migration before applying it.
2. Run `supabase/migrations/20261028_0001_lockd_catalogue.sql` in the project's SQL editor or with the Supabase CLI.
3. Add actual rental records only after the owner, listing details, images, price, currency, pricing unit, and publication approval have been verified.
4. Add one availability row for each date that has confirmed capacity. A date without a row is treated as unavailable. Only confirmed bookings reduce that capacity.

The migration intentionally creates no inventory records. The included photographs are editorial inspiration and are not rental records.

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
- `POST /api/availability` calls the database function, which checks every date, configured unit capacity, and confirmed booking overlap.
- `/sitemap.xml` is rewritten to a public sitemap handler. It lists the public pages and, when Supabase responds, only published and approved rental slugs.
- A date check is not a booking hold or confirmation.
- LOCKD currently has no configured checkout, payment, cancellation, owner approval, notification, or payout API. The UI therefore does not show `Reserve Now` or `Secure My Booking`.
- `checkout_enabled` is a schema field for future use; it does not activate checkout.
- Owner and administrator write paths must be added with authenticated server-side authorization before accepting submissions or approvals.
