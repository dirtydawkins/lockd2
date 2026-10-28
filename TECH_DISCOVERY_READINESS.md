# LOCKD Tech & Gadgets discovery

Audit date: 2026-10-28. This is an implementation and evidence checklist, not a production-readiness certificate.

## Implemented surface

| Requirement | Location | Verification | Status and dependency |
| --- | --- | --- | --- |
| Dedicated, browse-first Tech & Gadgets page and homepage entry points | `tech.html`, `tech.css`, `index.html`, navigation in `rentals.html`, `rental.html` and `owners.html` | HTML/link checks and source review | Implemented. Live listing results remain unavailable while Vercel lacks Supabase configuration; rendered browser QA remains outstanding. |
| Category paths for gaming, phones, computers, cameras/creator, audio and work | `tech.html`, `api/listings.js` | API handler tests for groups and filters | Implemented in UI and API. Only exact category or `market_category` tags are returned. |
| Filters for brand, type, condition, duration, accessory, location, price, date quantity, collection and delivery | `tech.html`, `tech.js`, `api/listings.js`, migration `20261028_0002_lockd_tech_discovery.sql` | API handler tests; live-data checks require Supabase | Implemented against actual published rows. Owner listing attributes and calendar rows must be populated. |
| Published-only item cards with no illustrative products treated as bookable inventory | `api/listings.js`, `tech.js` | Handler tests confirm published/approved filters and owner fields are not returned | Implemented. No live listing data was available in the deployment probe. |
| Product detail, actual listing fields, related published rentals, availability and rental-subtotal estimate | `rental.html`, `rental.js`, `api/availability.js` | Unit/handler tests and a published-record browser journey | Partial. Subtotal estimates cover configured day/night, whole-week, whole-month and trip rates; fees/deposits remain separate. No booking hold or checkout flow exists. |
| Custom bundles from real published rentals | `rentals.html`, `catalogue.js`, `rental-pricing.js`, `api/availability.js` | Shared pricing unit tests; date validation and availability handler tests; source review | Partial. Customers can select published listings, quantities, dates, collection/delivery preference and extras; exact-period estimates and per-listing availability checks are supported. Availability is not a hold. Bundles do not validate component compatibility or complete checkout, and extras/delivery fees are not priced. |
| Provider benchmark price distinct from LOCKD listing price | `data/tech-market-benchmarks.json`, `api/benchmarks.js`, `tech.js`, migration `20261028_0002_lockd_tech_discovery.sql` | Snapshot tests verify source URLs and research dates; browser check confirms non-bookable labels | Implemented. 39 source-linked records are seeded as market references, not rental stock. Prices may change; records disclose configuration, fee, availability and freshness limits. |
| Phone price honesty | `data/tech-market-benchmarks.json`, `tech.js` | Research source review | No current Kenyan short-term phone rate with clear rental terms was verified. Rent-to-own and credit offers were excluded; the UI displays no phone rate. |
| Image mapping and usage notes | `TECH_ASSET_MANIFEST.json`, `index.html`, `tech.html` | Asset-path and manifest review | Uses user-supplied console and phone photos as editorial illustrations only. Rights ownership was not independently verified; no provider product images are copied. |
| Favorites, recent views, saved searches and comparisons | `tech.js`, `tech.html` | Source review; browser interaction QA outstanding | Implemented in local browser storage. Account sync, sign-in return state and booking history are not implemented because LOCKD authentication is not present. |
| Use-case discovery | `tech.js`, listing `attributes.use_cases` | Data-driven render check | Implemented only when published inventory has recognized use-case tags; otherwise section stays hidden. |
| Benchmark administration | Table/RLS in `supabase/migrations/20261028_0002_lockd_tech_discovery.sql` | Migration inspection; DB policy test not run | Admin role can edit through Supabase only when JWT `app_metadata.role=admin` is assigned by a trusted process. No LOCKD admin web console exists. |
| Responsive layout, accessible labels and reduced motion | `tech.css`, `styles.css`, `tech.html` | CSS/DOM review; responsive browser check unavailable | Responsive styles, focus states and reduced-motion rules are implemented in code. Screen-reader and real-device verification remains outstanding. |
| SEO and public discovery | `tech.html`, `api/sitemap.js`, `robots.txt` | Sitemap handler test and metadata review | Tech page is canonical and included in the sitemap. Real listing pages remain noindex until a published record resolves. |
| Syntax, local HTML links and ids, JSON records, SQL seed parity and whitespace | `node --check`, standard-library HTML parser, data/seed integrity script, `git diff --check` | Passed: JS syntax valid, all five HTML pages have unique ids and valid local files, all 39 JSON records match 39 SQL seed rows, diff check clean. |
| Build, typecheck and lint | Project scripts/configuration | No package manifest, build command, TypeScript project or lint configuration exists in this static HTML/serverless repository; no separate command was available. |
| Browser rendering, responsive screenshots and keyboard traversal | Browser visual QA | Not run: Windows browser automation reports local browser use disabled in Work settings. Responsive styles and focus states were reviewed in source; rendered interaction and real-device QA remain outstanding. |

## Price research notes

Rates were researched on 2026-10-28 from published Kenyan provider pages or their official catalogue results. The snapshot separates billing periods, does not convert weekly or monthly rates, does not calculate an average across different products, and never uses a provider rate as a LOCKD price.

- [Flexi Gear catalogue](https://flexigear.co.ke/) and product pages: gaming consoles, VR, laptops, tablet, drones and speakers. Several search-indexed records were weeks to two months old and the provider homepage timed out during direct retrieval; each affected record is marked for direct confirmation.
- [Tarf Media equipment catalogue](https://www.tarfmedia.co.ke/hire): cameras, lenses, lighting, gimbal, audio, streaming and drone rates. Daily prices, checkout discount and payment notes are recorded separately; customer-date availability was not checked.
- [Cloudbackup laptop rental rates](https://cloudbackup.co.ke/laptop-rentals/): daily, weekly and monthly business-laptop references. Exact model/configuration is quote-dependent; deposit amount is not published.
- [Rolim projector hire](https://www.rolimwholesalers.co.ke/product/quality-projector-for-hire/): KSh 2,200/day; model is not named and delivery is extra by distance/weight.
- [Janeson PlayStation event hire](https://janeson.co.ke/product/play-stations-for-hire-in-nairobi/): the page shows KSh 7,999/day while its text says “from KSh 7,000.” It is retained only as a visibly conflicted event-package reference, not as a standalone-console comparison.

The Tarf page marks the Canon 90D unavailable; its displayed rate is disclosed as an unavailable provider quote. Provider stock labels are not date availability. The DJI source's KCAA claim has not been independently checked. No current short-term iPhone rental rate with clear rental terms was verified; rent-to-own/financing results were excluded.

## Acceptance checklist and results

| Check | Method | Result |
| --- | --- | --- |
| Browse categories without entering search text | HTML link check and source review | Implemented; live rows are blocked until Supabase is configured. |
| Verify filters send actual supported values to the published-listing API | `node --test` API tests | Passed. Coverage includes technology group, brand, type, condition, duration, accessories, location, price, delivery/collection, use case, date range, sort, bad inputs and published-only output. |
| Verify date filters check published calendar capacity | Mocked API test plus SQL review | Passed with a mocked RPC response and SQL inspection; live function not run because Supabase is not connected here. It creates no hold. |
| Verify each researched price has provider, source URL, billing unit and research date | JSON field/count integrity script and endpoint test | Passed for 39 records; every source is HTTPS and has a valid research date. The SQL migration contains matching seed rows. |
| Verify benchmark records cannot enter listing detail or checkout | Endpoint/data review and handler test | Passed: benchmarks have no LOCKD listing or booking ID; no checkout is configured. |
| Verify rental and bundle subtotal rules for supported billing units | `tests/pricing.test.js` | Passed: daily, nightly, weekly, monthly and per-trip rates; unsupported hourly date-only rates, partial weekly/monthly periods and invalid inputs do not produce invented totals. |
| Verify image mappings and non-listing labels | Manifest and page review | Editorial-only labels are present; exact image rights remain unverified. |
| Run repository and pricing unit tests | `node --test` | Passed, 16/16 tests. |
| Exercise actual item pages, availability, booking, payment, failed payment and concurrent attempts | Full browser/database journey | Not runnable: Vercel's catalogue was previously observed returning `503 catalogue_not_configured`; no checkout/booking/payment engine exists. |
| Verify owner account and admin web workflows | Authenticated role testing | Not implemented. Admin DB policies are not a user-facing admin console. |
| Mobile, keyboard and assistive technology | Real browser/device checks | Responsive layout/focus/reduced motion are implemented in code; real browser, device and assistive-tech QA remains outstanding. |

## Safe current description

The Tech Edit is a source-backed discovery interface with actual-data filters and non-bookable provider benchmarks. It is not a functioning electronics marketplace until Supabase settings and migrations are applied, verified owner listings and calendars are loaded, authentication and booking/payment workflows are implemented, and the outstanding acceptance journeys pass. No phone price, owner identity, stock figure, review or customer-date availability is invented.
