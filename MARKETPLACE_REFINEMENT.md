# Marketplace refinement — 1 November 2026

## Decisions preserved

The current LOCKD mode, colours, logo, typography and hero remain. No theme switch or light/dark configuration was introduced; styles.css is unchanged. Selected search, category, gallery and form layouts were refined using existing design tokens. No Figma file or new reference image was accessible or claimed as inspected.

Latest terminology takes precedence: Listers offer stays, vehicles, equipment and experiences; Renters book them. The existing owner role and host-prefixed database fields remain internal compatibility names. Google and email use the same existing Supabase account for renting and listing. Apple remains removed.

Public lister discovery requires explicit consent and genuine published, eligible listings. Private renter accounts and email addresses are not a directory. Messages remains separate; its name search covers only existing authorized conversation counterparties. Sections depend on real records/capabilities. No synthetic inventory, reviews, bookings, conversations, provider responses or success states were introduced. Historical fixture suites were not run for this increment.

## Implemented source

| Area | Implementation | Verification and limit |
|---|---|---|
| Existing visual identity | index.html, tech.html, marketplace-refinement.css | Inbuilt-browser screenshots; Tech checked at 320, 375, 390, 430, 768, 1024, 1440. No horizontal overflow or broken images in these checks. Original supplied photos retained. |
| Unified landing search | unified-search.mjs, app.js, catalogue.js | Actual experience search carries q/category/kind into the existing listing backend. Genuine empty results observed. Lister tab appears after public eligible profiles exist. |
| Lister discovery/profile | lister-discovery.mjs, lister.html, lib/hosts-api.js, migration 0015 | Real RPC returns an empty directory. Opt-in, publication eligibility, pagination and privacy enforced in SQL. Populated profile journeys blocked by absent genuine listings. |
| Lister registration/access | owners.html/js, account-service.js | Existing Google/email auth reused, return path retained; guest controls inspected. Fresh OAuth/registration was not performed this increment. |
| Public profile editing | lister-profile.mjs, lib/host-profile-api.js | Authenticated own-profile RPC; editor waits for an actual owned listing. No new account or fake listing created to exercise it. |
| Separate messages | messages.html/mjs, migration 0017 | Conversation name search and participant-scoped projection implemented. Messaging remains disabled pending independent crypto/security review. No messages sent. |
| Utility-bill photos | document-upload.mjs, verification.mjs, private-client.mjs, documents/{jobs,safety,worker}.py, migration 0014 | JPEG/PNG/WebP signature/decode limits, photo preview, metadata stripping, real upload progress; storage trigger and isolated parser reject utility PDFs. Other supported evidence retains PDF handling. Intake remains disabled; scanner/OCR/provider end-to-end checks blocked. |
| Reviews | reviews.html/mjs, review-admin.mjs, lib/reviews-api.js, migration 0016 | Completed booking, payment and bilateral handover eligibility; duplicate/self-review constraints, moderation audit, replies/reports/appeals, public aggregation. Disabled by default. No genuine completed bookings exist for integration tests. |
| Rental gallery | rental-gallery.mjs | Actual image controls, keyboard/touch/lightbox and reduced-motion styles implemented. Populated rental runtime test blocked by absent real listings. |

## Database release

Migrations 0012–0017 were applied to existing Supabase project hqlrzbyhccoptjgyslhy in one transaction. This added schema/settings, not marketplace records. Subsequent live read-only audit found zero LOCKD tables without RLS (table relkind r/p), anonymous direct profile/review reads denied, private evidence/chat buckets private, and zero listings, bookings, reviews and conversations. Review capability returned configured=true, enabled=false; messaging enabled=false; public listers=[]. No administrator identity was created or reassigned in this release. Document uploads, payment collection and booking-request activation were not enabled.

## Verification

- Nine read-only source checks: JavaScript syntax, local asset references, deployment exclusions/function limit, utility enforcement, public-profile privacy, review constraints, participant-scoped inbox projection, shared Google account flow and customer-copy checks.
- All 17 actual migration files parsed using pglast 8.7; Python modules compiled.
- Real local handlers queried the existing Supabase project. Search empty states were based on actual responses, not mock API success.
- Browser checked original desktop/mobile palette and image framing, experience-search URL/results, public lister empty state, Google/email lister entry and absence of theme controls. No console errors observed in inspected pages.
- Dependency audit and GitHub workflow results are recorded with the release outcome below.

Record-dependent booking/review/conversation tests and cross-account mutation tests remain blocked by the no-fabricated-records policy and lack of qualifying genuine records. Source checks and SQL parsing do not prove complete runtime security. Do not call the entire platform production-ready from these checks.

## Existing API inventory

- /api/availability: existing route/helper; existing authentication and method handling retained. No new provider or fabricated service result.
- /api/bookings: existing route/helper; existing authentication and method handling retained. No new provider or fabricated service result.
- /api/config: existing route/helper; existing authentication and method handling retained. No new provider or fabricated service result.
- /api/documents: existing route/helper; existing authentication and method handling retained. No new provider or fabricated service result.
- /api/listing-images: existing route/helper; existing authentication and method handling retained. Configuration/image helper, not a new business API.
- /api/listings: existing route/helper; existing authentication and method handling retained. Public eligible listings plus opt-in lister directory/profile views.
- /api/messages: existing route/helper; existing authentication and method handling retained. No new provider or fabricated service result.
- /api/nearby: existing route/helper; existing authentication and method handling retained. No new provider or fabricated service result.
- /api/owner-listings: existing route/helper; existing authentication and method handling retained. Verified account listing management plus own lister-profile RPC.
- /api/sitemap: existing route/helper; existing authentication and method handling retained. No new provider or fabricated service result.
- /api/supabase-config: existing route/helper; existing authentication and method handling retained. Configuration/image helper, not a new business API.
- /api/trust: existing route/helper; existing authentication and method handling retained. Existing private trust operations plus public review capability/eligible-review reads and authenticated review actions.

Intelligence routes remain /health, /ready, /v1/risk/assess, /v1/rentals/eligibility, /webhooks/persona, /v1/jobs/persona/reconcile, /v1/integrations, /v1/jobs/documents/process and /v1/jobs/documents/retention. Internal routes require existing shared-secret authorization; Persona callbacks require provider verification. Health is not proof that an external provider is configured.

## Remaining dependencies and incomplete scope

Independent messaging/crypto review; configured safe malware scanner/OCR processing and approved document/legal retention policy; Persona account setup; real payment callbacks/refunds/payout reconciliation; real qualifying inventory and transactions for authorization/concurrency tests. Review editing/redaction, photo reviews, reciprocal renter reviews, card-level ratings and visible rating distribution are incomplete. No fake ratings fill their place. Broad trust, KRA, messaging and payment capabilities in the briefs are not all completed by this increment.

## Release outcome

Pending GitHub CI, Vercel and Render verification at report creation. See the final release entry for actual status; local code is not itself deployment evidence.

Live validation caught and repaired the legacy lister-page session refresh competing with the shared account service. Lister session restoration, refresh and sign-out now delegate exclusively to LockdAccount. Native skipped-transition promises are handled without changing animations or theme.
