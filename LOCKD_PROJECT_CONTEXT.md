# LOCKD project requirements

Latest user decisions, 1 November 2026. Preserve these across subsequent work.

- The final customer and owner UI must use genuine account, listing, booking and conversation records only.
- No mockups, synthetic conversations, demo inventory, fabricated history, fake availability, simulated success or QA/test labels in the final product.
- Show truthful, useful empty states when no real records exist. Never disguise sample data as genuine inventory.
- Latest merged briefs prohibit fabricated marketplace records and mock API success in every environment, including tests and screenshots. Do not run historical fixture-creating suites for this increment. Use source/SQL parsing, genuine authorized assets, actual read-only service responses and safe validation; mark record-dependent journeys blocked until genuine qualifying data is available. Preserve historical tests as excluded source, without presenting their prior runs as current verification.
- Messaging must feel seamless and familiar, with a simple inbox, conversations, search, attachments, receipts, reply, copying, reporting and blocking preserved.
- Reuse the user's existing signed-in LOCKD account. No second messaging sign-in, separate message password or routine key-setup flow.
- Generate and manage elliptic-curve device identities automatically. Use fresh per-message AES session keys protected by the recipient's public key; account identity, passwords and authentication tokens are not encryption keys.
- Keep private keys on authorized devices and ordinary messages encrypted. Do not introduce a server-wide decryption key or silently replace a contact's known identity.
- Describe the protocol actually implemented. Do not claim Signal security equivalence, forward secrecy, independent review or live verification without evidence.
- Necessary sign-in, security and preference cookies/storage are authorized. Do not enable optional tracking merely because essential storage is allowed.
- Use the inbuilt browser for website verification. Keep production screens free of test content.
- Some requested capabilities are foundations for real provider accounts and data to be connected later. Build those foundations without forcing provider setup, diagnostic text, unsupported controls or unfinished workflows into the customer UI. Expose entry points only when the underlying capability is genuinely configured and enabled.
- Preserve LOCKD's existing architecture, authentic supplied images, brand, marketplace functionality and one Supabase identity system.

This document is development context, not customer-facing copy. Markdown and test artifacts are excluded by `.vercelignore`.

- Preserve the hero and search identity; refine selected layouts and remove buzzwords and customer-facing integration diagnostics (including connected/not connected).

- Latest terminology override: use Lister/Listers, not Host/Hosts, for everyone offering stays, items, cars and experiences. Use Become a lister, Message lister and Lister dashboard; customers are Renters. Existing database owner/host identifiers are internal compatibility details and do not create separate accounts.

- Preserve the current visual mode exactly. Do not add light/dark toggles, a new theme, or theme setup text. Keep the current colour palette, typography and hero treatment.

- Migrations 0012–0017 applied on 1 November 2026. Live audit: all LOCKD tables RLS-enabled, private profile/review direct reads denied, private buckets private, zero business records, reviews/messaging disabled. See MARKETPLACE_REFINEMENT.md for verification limits and release status.

- Browser-comment copy choices: homepage eyebrow “Stays and rentals, all in one place.”; car-image right caption “Find your next drive” (overrides Drive your way), left caption Cars & mobility. Preserve theme. Fix narrow footer Privacy/Back to top overlap with separate 44px touch targets.
- Production drift repair 0018 applied: restored existing migrations 0004–0006 definitions for owner publication, indexed search and location/discovery. Actual lister history now loads via the existing signed-in account, showing zero listings. No inventory was created.

- Current map decision: OpenFreeMap + MapLibre GL JS 6.16.0, Supabase PostGIS, permission-based browser location and approximate Vercel area fallback. Google Maps/billing abandoned; no Google Maps key, paid plan or prepayment. Preserve current theme. No invented pins, listings or availability.
- Migrations 0019–0021 applied on 1 November 2026. PostGIS installed in extensions, two spatial indexes; public geometry/private place IDs denied. Existing nearby RPC now uses ST_DWithin; map RPC uses spatial bounds and existing calendar checks, published/approved records only. All public listing points are rounded to neighbourhood scale.
- Geoapify account created by the user; approved LOCKD project confirmed Free ($0/month, 3,000 credits/day). GEOAPIFY_API_KEY transferred directly to private Supabase Edge Function settings, never chat/source/frontend. Actual lockd-places function deployed, validates the existing project publishable key. Private DB cache, 2,500/day hard cache-miss cap and 400ms global spacing. No Nominatim, Google, AWS or routing provider activated.
- Real locality lookup tested with provider-returned Nairobi. These are genuine place references, not rental inventory. Homepage selection stays on LOCKD, has a shareable stable place ID and restores its map centre. No customer OAuth/account/Geoapify redirect; only optional legal attribution links open externally on an explicit click.
- Six-step lister flow reuses existing account, category fields, uploads, draft/publish handlers and calendars. Place selections verified against server-sourced DB records on publication; legacy arbitrary-coordinate route cannot bypass this. Separate private address/pickup/return storage, no private instructions in public attributes or local draft storage. No new identity or booking backend.
- Verification to date: 11 source checks, 21 SQL files parsed, 13 actual map/place/privacy endpoint checks, real existing signed-in lister history still empty, seven widths 320–1440 checked for overflow/broken images; inbuilt-browser map screenshots. Populated map marker, full publication/edit/resume and booking journeys remain untested without authorized genuine inventory. No synthetic records created. Latest frontend map release is local pending CI/deployment verification; consult MAP_DISCOVERY_RELEASE.md.
