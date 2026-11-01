# Free map and verified places — 1 November 2026

## Implemented and applied

| Requirement | Implementation | Actual verification |
|---|---|---|
| Existing marketplace map | discovery-map.mjs/CSS, /api/listings?view=map, lib/map-api.js | Real MapLibre/OpenFreeMap tiles, pan/zoom, category filtering, Map/List, loading and empty states in the inbuilt browser. No fake inventory or markers. |
| Spatial database | Supabase migration 0019 | Applied. PostGIS in extensions, two GiST indexes, ST_Intersects viewport search and ST_DWithin nearby search. Actual map response items=[], total=0. |
| Real inventory / dates | Existing lockd_listings and calendar functions | Publication eligibility enforced in SQL and rechecked on public record reads. Date and price validation tested against actual endpoints. Populated availability/marker journeys need genuine listings. |
| Browser location | discovery.js, vercel.json | Fixed the root geolocation=() header to self-only permission access. Location is requested on an explicit action and rounded before transmission; never saved to the account automatically. An actual successful device-location return remains device/permission-dependent. |
| Approximate fallback | lib/approximate-area.js, /api/config | Uses only Vercel's platform area headers, rounded to roughly city scale; no external IP lookup or retained raw IP. Manual selections take priority. Production header availability is checked after deployment. |
| Real place search | place-picker.mjs, discovery-locations.mjs, lib/places-api.js, Supabase lockd-places Edge Function, migration 0020 | Deployed Edge Function and private schema. Actual Geoapify response for Nairobi cached and restored through a stable UUID. No customer redirect to a provider. |
| Free service controls | Geoapify project / private Edge settings | Dashboard confirmed current plan Free, $0/month, 3,000 credits/day. App imposes 2,500 uncached requests/day and 400 ms global spacing, with 30-day caching; no paid fallback. Key transferred directly between dashboards, never source/chat/frontend. |
| Guided listing creation | owner-guided.mjs, owners.html/js, place-picker.css | Six stages reuse existing auth, fields, upload and publication logic. Numeric coordinates removed from visible form. Full valid publication cannot be exercised without an authorized real asset. |
| Server place verification | Supabase migration 0021 | Applied. Existing create/status functions wrapped; legacy arbitrary coordinates cannot bypass verified locality selection. Base function execution revoked from clients. No new owner/booking system. |
| Private addresses | lockd_listing_private_locations; owner-scoped my_lockd_listings | Address/pickup/return data separated from public listing attributes. Anonymous table/column reads actually denied. No private directions written into browser draft recovery. Access for future confirmed reservations remains a separate operational dependency. |
| Responsive / accessible design | Existing tokens, native filter disclosure, keyboard map controls, reduced-motion handling | Map checked at requested 320, 375, 390, 430, 768, 1024, 1440 sizes; measured no horizontal overflow or broken images. Mobile and desktop screenshots inspected. Brand, existing visual mode and supplied photos retained. |
| Existing account compatibility | Existing LockdAccount, /api/owner-listings | Actual signed-in lister history still loads with zero listings after schema changes. No second LOCKD sign-in, test account or sample listing created. |

MapLibre is pinned to the official npm package; production ESM/worker/CSS files and its license are served locally and loaded only for map use. CSP keeps script-src and worker-src self; only the OpenFreeMap tile host was added. Legal attribution remains visible. Routing/openrouteservice was not added because no route calculation is required for this flow.

## Checks

- 11 read-only source checks: syntax, asset references, deployment function limit/exclusions, existing privacy boundaries, PostGIS/source integration, verified places and private address separation.
- 21 migration files parsed with pglast 8.7. Parsing is not a substitute for runtime verification; migrations 0019–0021 were also applied successfully to the existing project.
- 13 actual endpoint checks in scripts/check-map-live.cjs: public map contract, invalid bounds, past dates, currency requirement, genuine locality lookup/restoration, nearby PostGIS search, private column/table denial and rejection of requests without the Supabase project key. No mocked responses or fixture inventory.
- npm audit returned zero vulnerabilities at the implementation check. CI runs npm audit plus existing Python compile/SQL parsing/dependency audits.
- No new payments, messages, reviews, identity evidence or reservations were created or enabled.

## Limits

The catalogue has no genuine published inventory. Populated pins/card actions, valid listing publication/edit/resume, actual device geolocation success, concurrent bookings and cross-account transaction tests have not been simulated or marked passed. The existing disabled payment/booking/trust/messaging features retain their earlier prerequisites. This release does not establish whole-platform production readiness or legal compliance.

## Deployment

Supabase migrations and the lockd-places function are applied. Commit 68a87c0 passed GitHub CI (run 41337783168), was pushed to main, and its production module/config/header and 13 actual endpoint checks were verified. The follow-up location/cookie UX is tracked in LOCATION_PRIVACY_RELEASE.md.

## Provider references

[OpenFreeMap](https://openfreemap.org/quick_start/), [MapLibre](https://maplibre.org/maplibre-gl-js/docs/), [Supabase PostGIS](https://supabase.com/docs/guides/database/extensions/postgis), [Geoapify Free plan](https://www.geoapify.com/pricing/), [Geoapify locality search](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/).
