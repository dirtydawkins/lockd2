# LOCKD interface and account continuation — 5 November 2026

This extends `RELEASE_20261105.md`; it does not certify the entire marketplace as production-ready.

## Implemented

- Preserved the approved homepage composition. Reused the supplied path-based SVG identity across all existing pages. The map uses OpenFreeMap Liberty, ordinary page scrolling, drag/pinch/zoom controls and genuine catalogue records. Cooperative gesture prompts and the old colour override are removed.
- Rebuilt the existing location popover/mobile sheet with the supplied visual concept: clearer search, current-location action, genuine recent places and Anywhere. No fabricated popular places were added. The original location state, browser permission action, real place service, cookies and PostGIS map queries remain authoritative.
- Updated working interior-page forms, filters, account navigation, cards and copy through the shared design system. Preserved original photographs and the approved homepage layout. Removed repetitive publication/setup wording from normal customer copy and sign-in callback screens.
- Reworked Messages into account navigation, a searchable/filterable inbox and a separate conversation panel. All/Rentals/Bookings/Unread use actual conversation metadata. Listing photos are signed using the existing caller identity and Storage policies; names, timestamps and unread counts come from the existing inbox RPC. No invented previews, users or conversations were added.
- New message searches the existing public rental/lister endpoints, lets customers choose an actual rental and calls the existing participant-scoped conversation RPC. It stays on the Messages page. Private renters are not exposed in a public directory. This flow still needs a genuine eligible listing/contact to verify creation and two-party delivery.
- Message encryption, device identity, contact-change checks, reporting, blocking, receipts and attachment capability gates are preserved. Privacy/device information is collapsed and uses plainer language. No separate message login/password or server decryption key was introduced. This is not a claim of Signal equivalence or an independent crypto audit.
- Added account photo upload/removal and own-account menu display using the existing `avatar_url` field. The browser decodes JPG/PNG/WebP, crops to 512px WebP and drops source metadata; Storage accepts one private WebP per account, maximum 512 KiB. Owner-only Storage policies control upload, update, read and removal. Signed photo URLs expire after one hour and are not stored in the profile. No photo or account was invented for testing.
- Fixed profile updates resetting unspecified preferences. Name, photo and preference saves now update only supplied permitted fields. Added Privacy & data, existing cookie controls, actual sign-in methods and working section deep links. No unconfigured notification or financial control was presented as functional.

## Backend and configuration verified

| Area | Actual evidence | Limits |
|---|---|---|
| Supabase 0025/0026 | Both migrations returned Success in the inbuilt browser. Caller unlock scoped; private contexts service-only; legacy worker bypass revoked; private-table anonymous reads denied. | Genuine protected statement/parser journey remains untested; intake off. |
| Supabase 0027 | Applied successfully. Private bucket, 512 KiB limit, WebP restriction and four authenticated account-scoped policies verified by SQL. | Genuine photo upload/remove persistence still requires an account photo chosen by its owner. |
| RLS / activation | Zero LOCKD tables without RLS; payment and verification intake false; zero sandbox members. | Does not substitute for cross-account record tests. |
| Private bridge | New user-approved token saved only in Render/Vercel private settings. Authenticated Render request returned 200; unsigned document/payment routes denied. User confirmed retaining this token. | Vercel deployment must include the new private settings. |
| Render | Existing Free service deployed `71b66b6baf199460c1dbc023ea6572265243c91f`, deploy `dep-dbm46m59fdbs73bq3bv0` reached live. Health/readiness and both provider authorization checks passed. | Later checkout/loading changes await the rollout recorded below. Free service is not an always-on worker guarantee. |
| Daraja | Actual sandbox authorization returned 200 and verified true. | No payment processed; collection remains off. |
| Paystack | Actual test authorization returned 200 / verified true after adding the truthful LOCKD User-Agent; the earlier rejection was caused by the default Python request header. The user’s secret was not changed. | No charge or successful payment/webhook journey was performed. Live merchant credentials and configuration are still needed. |
| Google | Actual production Google flow returned through the callback and opened the existing account dashboard with the stored profile. | No email/password reset/delivery or new-user verification test was performed in this increment. Apple remains removed by request. |

## Tests actually run

- `npm test`: 15 read-only application/security/source checks passed. No historical fixture-seeding suites ran.
- `scripts/check-payment-integrations.py`: six checks passed; no payment or provider success was fabricated.
- `scripts/check-verification.py`: eight checks passed, including actual isolated rejection and conservative missing-evidence handling.
- All 28 migration files parsed with pglast. Live application and policy checks above were performed separately.
- Inbuilt-browser layout bounds and visible-image checks at 320, 375, 390, 430, 768, 1024 and 1440px: Technology, rentals, rooms, destinations, account, Messages, lister workspace, rental updates, verification, rental detail without a selected record, lister profile without a selected record, reviews, privacy and authentication callback. No page overflow or broken visible images observed in those loaded states.
- The location sheet also stayed inside the viewport at all seven widths. Desktop map and mobile location compositions were visually inspected. These checks do not establish populated private forms, touch hardware behavior or a successful GPS fix.
- JavaScript parse checks and `git diff --check` passed.

## Remaining dependencies

Genuine inventory/participants are still needed for full publication, populated map, two-party messaging, positive availability/concurrency, saved-rental and booking journeys. Persona/Peleza remain deferred. OCR/scanner provisioning, actual statement-format validation, qualified policy/legal review, live merchant checkout activation, refunds, payouts and settlement remain incomplete or disabled. KRA, Flutterwave and AWS remain excluded. No production payment, verification decision or booking confirmation was invented.

Release-candidate verification above precedes rollout. The final rollout record is appended after GitHub/Vercel and signed-in browser checks.


## Reservation, performance and desktop-picker continuation

- Reservation requests enabled in `lockd_booking_settings` and production Vercel `LOCKD_BOOKING_REQUESTS_ENABLED`. They use existing authenticated RPCs, pricing, availability, holds, approval rules and booking history. This does not mark requests confirmed or paid.
- Migration 0028 applied successfully in the existing Supabase project. All three new checkout tables have RLS; anonymous summary access is denied, customers have only their scoped summary RPC, clients cannot execute payment confirmation, live checkout is off and zero payment attempts were created. Seven live SQL assertions passed.
- Added `checkout.html`, `checkout.mjs`, `checkout.css`, `lib/checkout-api.js`, `services/intelligence/checkout.py` and the migration. The existing bookings endpoint and history now open the actual persisted reservation, pricing/deposit summary, cancellation and status controls. Authentication continues through the same account.
- Hosted Paystack checkout code persists an idempotent attempt before initialization, validates hosted URLs, verifies transactions server-side, checks exact amount/currency/reference/environment and serializes capacity before confirmation. HMAC webhooks wake reconciliation; browser callbacks cannot mark paid. Late/conflicting payments enter review. Test transactions cannot confirm real bookings. This is implemented code, not a verified positive charging flow; runtime and database payment gates remain off.
- Reduced discovery work: cancel the hidden list feed in map mode, deduplicate repeated map requests, avoid rebuilding unchanged markers/cards, render feed sections independently, add bounded timeouts and preserve clear retry states. Catalogue/map/nearby cover signing uses one caller-scoped Storage batch instead of one request per photo. No cross-account signed-URL cache was added. No speed percentage or populated-inventory benchmark is claimed.
- Desktop location picker now anchors below the sticky header, clamps to available space, bounds long results and coalesces resize work. Hidden menu triggers fall back to the visible menu control. Real Nairobi lookup/selection, desktop 1440/1024 bounds and focus, Escape restoration to the menu, and a 390px mobile sheet were checked in the inbuilt browser. No GPS permission was requested automatically.
- Session refresh preserves saved authentication during temporary network/server/rate-limit failures. Only definitive invalid-session responses clear it. Reservation endpoints distinguish temporary identity service failure from expired sign-in.
- `scripts/check-checkout.py` passed actual ASGI disabled-route/webhook rejection plus migration-boundary checks, without provider calls, seeded accounts or charges. JavaScript/Python parse checks and `git diff --check` passed. Read-only application/payment checks passed; 28 migrations parsed.

The user’s latest “enable everything” authorizes activation of configured features; it does not supply missing live merchant credentials, deferred identity providers, a scanner/OCR service or genuine inventory. Those dependencies remain explicit and are not represented as successful operations in the UI.
