# Supabase catalogue setup

The catalogue reads only approved, published rows from `public.lockd_listings`. The SQL migration is namespaced and additive; it does not seed sample rentals or modify existing tables. Public roles receive column-level access to listing fields only; owner IDs and update metadata are not granted.

## Apply the migration

1. Open the Supabase project that will serve LOCKD and review the migration before applying it.
2. Run `supabase/migrations/20261028_0001_lockd_catalogue.sql` in the project's SQL editor or with the Supabase CLI.
3. Run `supabase/migrations/20261028_0002_lockd_tech_discovery.sql` if it has not already been applied. This adds listing terms and technology filters.
4. Run `supabase/migrations/20261028_0003_lockd_private_research.sql` to restrict internal market research to authenticated LOCKD administrators.
5. Run `supabase/migrations/20261028_0004_lockd_owner_publishing.sql` to enable authenticated owner drafts, direct publication of complete listings, private owner listing management, and owner-scoped photo uploads.
6. Run `supabase/migrations/20261028_0005_lockd_unified_search.sql` to add indexed full-text search, typo-tolerant title/model matching, category-aware relevance ranking, and filtered result counts.
7. Run `supabase/migrations/20261028_0006_lockd_discovery_feed.sql` after 0004 and 0005. It adds optional approximate owner map pins, publication timestamps, indexed nearby search, and an authenticated wrapper around owner listing writes. Public catalogue roles do not receive the coordinate columns.
8. Review and apply `supabase/migrations/20261028_0007_lockd_accounts.sql` only after confirming migration 0001 and its `lockd_listings` table are present. Migration 0004 is independently needed for owner publishing, but is not a prerequisite for customer profiles or saved listings. Migration 0007 adds customer profiles, saved listings, profile creation on Supabase Auth signup, and account-deletion requests with user-scoped RLS. It does not create customer bookings or change the owner identity system.
9. Add actual rental records only when the owner, listing details, images, price, billing unit, and availability have been verified. For technology listings, store owner-confirmed brand, model, configuration, condition, accessories, and use cases in `attributes`.
10. Add one availability row for each date that has confirmed capacity. A date without a row is treated as unavailable. Only confirmed bookings reduce that capacity.

Migrations 0001 and 0002 were applied to the connected Supabase project from the SQL Editor on 2026-10-28. Migrations 0003, 0004, 0005, and 0006 must be applied to production before their corresponding privacy, owner, ranked-search, and nearby-discovery features are active. The public API retains a bounded substring-search fallback while 0005 is pending and falls back to record creation ordering while 0006's publication timestamp is pending. Because previous migrations were run directly in the SQL Editor, they may not appear in the Supabase CLI migration history. Inspect the live schema before re-running them; establish a tracked migration baseline before adding future migrations.

The discovery feed uses no third-party geocoder. Manual area selection filters the actual `location_label` and does not infer distance. Current-location search is requested only after the visitor selects that action; it sends a rounded approximate coordinate to the nearby API for that request and does not save it in the URL or browser storage. The optional owner map pin should represent a neighbourhood area, never an exact entrance or home coordinate. A pin does not establish that an asset is available to book.

## Customer account and provider configuration

The local account UI reuses the existing Supabase Auth project and the same `lockd:owner-session:v1` session as the owner workspace. The new database migration `20261028_0007_lockd_accounts.sql` is **not applied to production**. Until it is applied, customer profile and saved-listing requests will receive database errors. Booking history remains explicitly unavailable because LOCKD still has no customer reservation-creation flow or customer-scoped booking query.

In Supabase Authentication → URL Configuration, set the Site URL to `https://lockd2.vercel.app` and allow these exact post-authentication redirects:

- `https://lockd2.vercel.app/auth-callback.html`
- `http://localhost:8765/auth-callback.html`
- `http://127.0.0.1:8765/auth-callback.html`

Add an exact callback URL for any Vercel preview before testing there; avoid a broad redirect wildcard. This LOCKD callback is the destination after Supabase finishes its provider callback.

For Google, create a Web application OAuth client in Google Cloud. Add `https://lockd2.vercel.app` as an authorized JavaScript origin (and localhost origins only for development), and set its authorized redirect URI to `https://hqlrzbyhccoptjgyslhy.supabase.co/auth/v1/callback`. Enable Google in Supabase Authentication → Sign In / Providers and enter the client ID and client secret there. The consent configuration needs the `openid`, email and profile scopes.

For Apple, use an Apple Developer account to enable Sign in with Apple on an App ID and create a Services ID attached to that App ID. On the Services ID, configure the website domain `hqlrzbyhccoptjgyslhy.supabase.co` and return URL `https://hqlrzbyhccoptjgyslhy.supabase.co/auth/v1/callback`. Create a Sign in with Apple key, then enable Apple in Supabase Authentication → Sign In / Providers and enter the Services ID, Team ID, Key ID and Apple client secret (a JWT generated from the `.p8` signing key) in the Supabase dashboard. Keep the `.p8` key securely; never commit it. Apple’s OAuth web flow does not return a full name, so LOCKD asks for one during account onboarding when neither the profile nor auth metadata has one. Apple’s OAuth client secret must be rotated every six months. Keep provider secrets in Supabase, never in this repository.

Configure a verified custom SMTP sender in Supabase Auth before relying on account verification and password recovery in production. The UI returns an enumeration-safe recovery message, but local code cannot verify email delivery until a real signup/reset email has been received and its callback completed. Google and Apple buttons use Supabase OAuth PKCE; neither provider has been live-verified from this checkout.

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
- `GET /api/listings?q=...` searches actual published and approved listings. With migration 0005 it uses a weighted PostgreSQL search vector, trigram typo matching, relevance ranking, and filtered pagination. Before 0005 is applied, the endpoint falls back to a bounded substring query; it does not return mock inventory.
- `GET /api/listings?category=stay` searches only approved accommodation records. Guest capacity and amenities are listing attributes; selected dates and requested room quantity use the server-side calendar search.
- `POST /api/availability` calls the database function, which checks every date, configured unit capacity, and confirmed booking overlap.
- `owners.html` provides email/password registration and sign-in, category-restricted draft and publish forms, owner-scoped photo uploads, and pause/resume/archive controls. These writes require migration 0004 in the connected Supabase project.
- `/api/owner-listings` verifies the signed-in Supabase user token and calls database RPC functions. Listing ownership and writes are checked with `auth.uid()` in the database; the app never accepts a service-role key.
- Migration 0004 creates a private image bucket with uploads restricted to each signed-in owner's UID folder. Owners receive signed URLs using their own session; public reads use one-hour signed URLs only for photos attached to published, approved listings. Published owner records use the same `lockd_listings` table that feeds public catalogue and detail pages.
- Publication creates a complete listing with `listing_status = 'published'` and `approval_status = 'approved'`; incomplete records remain drafts. Listings still require owner confirmation for booking, and online checkout is disabled.
- Date filtering uses `search_lockd_available_listings`, which returns IDs only. It remains a read-only availability check and does not hold inventory.
- Text-search relevance and typo-tolerance require migration 0005. It adds derived search fields and indexes without granting direct public access to those fields. It has not been applied to the connected production project.
- `/sitemap.xml` is rewritten to a public sitemap handler. It lists the public pages and, when Supabase responds, only published and approved rental slugs.
- A date check is not a booking hold or confirmation.
- LOCKD currently has no configured checkout, payment, cancellation, owner approval, notification, or payout API. The UI therefore does not show `Reserve Now` or `Secure My Booking`.
- `checkout_enabled` is a schema field for future use; it does not activate checkout.
- Owner-created listings are supported after migration 0004 is applied. There is not yet a customer reservation flow, admin web console, identity-verification workflow, or operator payout system.
- Saved rentals use the shared Supabase account service in this checkout and require migration 0007 before they persist in production. Recent views, saved searches and comparisons on the technology page remain device-local.
