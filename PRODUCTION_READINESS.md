# LOCKD production-readiness audit

Audit date: 2026-10-28. This records repository evidence only. It does not certify the deployed environment or legal compliance.

## Status key

- **Implemented, locally checked**: code exists and repository-level checks passed; external production behavior may still be unverified.
- **Partial**: a limited safe foundation exists, but it does not complete the customer or operator workflow.
- **Blocked by dependency**: code depends on a Supabase project, provider credentials, verified records, or approval that is not visible in this checkout.
- **Not implemented**: no production-capable code was found.

## Requirements and evidence

| Requirement | Implementation location | Verification method | Result in this audit | Outstanding dependency or work |
| --- | --- | --- | --- | --- |
| Browse, search and sort public listings | `rentals.html`, `catalogue.js`, `api/listings.js`, `tests/api.test.js` | API handler tests; verify only approved/published rows are exposed | **Implemented, locally checked** at the handler level; no live project/data verified | Configure the intended Supabase project and create reviewed inventory |
| Public listing details and images | `rental.html`, `rental.js`, `api/listings.js` | Load a published slug and confirm listing fields/images match database values | **Partial**; code path exists but not exercised against records | Publish verified listings and storage URLs; browser QA against live records |
| Availability checks | `api/availability.js`, `supabase/migrations/20261028_0001_lockd_catalogue.sql` | Handler tests for malformed/past dates and mocked RPC; DB tests for missing days, capacity and overlap | **Partial**; request validation is locally checked; SQL is unapplied/unexecuted | Apply migration; populate calendar; run database tests. Read-only check is not a hold |
| Prevent concurrent reservation conflicts | No reservation-creation endpoint or transactional lock exists | Run two simultaneous requests for the last unit and prove at most one succeeds | **Not implemented**; availability checks alone can race | Atomic booking/hold transaction with expiry and concurrency integration tests |
| Create customer booking requests | No authenticated booking endpoint or booking form | Submit valid and invalid requests as signed-in and anonymous users | **Not implemented** | Customer auth, booking rules, server-side create endpoint and abuse controls |
| Owner acceptance and rejection | No owner portal or decision endpoint | Verify only listing owner can accept/reject and transitions are enforced | **Not implemented** | Auth, owner/listing relationship, transactional state machine and audit records |
| Pending request expiry | No expiry worker or booking hold | Advance clock/run scheduled expiry; confirm inventory is released exactly once | **Not implemented** | Background scheduler, expiry semantics and idempotent transition procedure |
| Cancellation and rescheduling | No cancellation/reschedule routes or policies | Exercise allowed windows, fees, notifications, permissions and simultaneous changes | **Not implemented** | Approved customer/owner policies and server-side transition rules |
| Extensions and overdue returns | No extension/return management | Test owner approval, calendar conflicts, reminders, overdue calculation and evidence | **Not implemented** | Booking lifecycle, time-zone policy, operations and reminder service |
| Check-in/check-out and condition records | No handover workflow or evidence storage | Upload before/after evidence; verify permissions, timestamps and retention | **Not implemented** | Authenticated workflow, restricted storage, consent/retention policy and audit trail |
| Damage claims and disputes | No claim/dispute case workflow | Open, respond, resolve and appeal with role checks and immutable evidence history | **Not implemented** | Operations policy, evidence access controls, case records and legal review |
| Deposits and refunds | No deposit or refund integration | Verify provider-confirmed refund, partial refund, failure retry and ledger reconciliation | **Not implemented** | Payment provider, deposit model, permissions, reconciliation and legal approval |
| Checkout and payment methods | No checkout integration found | Sandbox full payment, failure, duplicate callback, reconciliation and refund tests | **Not implemented**; no configured provider evidence | Select an authorized PSP; credentials/contracts; implement signed/verified callbacks and idempotency |
| M-Pesa | No Daraja code/configuration found | Safaricom sandbox STK, callback authenticity, duplicate callback and reconciliation tests | **Not implemented** | Merchant account, Daraja credentials/callback URL, provider verification and finance/legal review |
| Owner payouts | No payout endpoint or financial ledger | Verify settlement and payout records against provider statements; test failures/reversals | **Not implemented** | Authorized payout arrangement, beneficiary verification, reconciliation, tax and legal review |
| Booking/payment notifications | No email/SMS/push integration or event delivery records | Test confirmed provider responses and show actual delivery state per event | **Not implemented** | Choose/configure service; event templates, retries, delivery records and privacy review |
| Customer authentication and permissions | No sign-in, session or role enforcement found | Attempt cross-user booking/listing/admin access and test session recovery | **Not implemented** | Supabase Auth or another identity provider, role model, authorization policies |
| Owner registration, verification and listings | `owners.html` is informational; no secure write API | Register, verify, create/edit listing and upload restricted files | **Not implemented**; page says owner portal is not open | Auth, moderation, secure storage, verification workflow and support operations |
| Administrator moderation and reporting | No administrator role/panel/report queries found | Verify role-gated access and reconcile dashboard figures against source records | **Not implemented** | Admin roles, audit log, real operational queries and access review |
| Privacy notice, retention and deletion | `LEGAL_REVIEW.md` identifies issues; no complete user-facing notice or deletion workflow | Map every collected field/provider, exercise data access/deletion, verify retention jobs | **Not implemented / legal review required** | Confirm data controller, purpose, providers/regions, notice, rights flow, retention and counsel review |
| Kenyan legal, tax and consumer review | `LEGAL_REVIEW.md` links official sources and questions | Qualified counsel/accountant reviews the real contracting, funds, tax and rental model | **Outstanding; no compliance claim made** | Confirm operating entity/model; obtain legal and tax review; recheck current law at launch |
| Security controls | `vercel.json`, `api/listings.js`, `api/availability.js`, catalogue migration, `tests/api.test.js` | Review security headers, RLS, column grants, authorization, upload validation, rate limits, abuse controls, logging, secrets, dependencies, backups and recovery | **Partial**: CSP/security headers, public read filtering, column-level listing grants and input validation are in code; handler tests pass; deployed headers, migration and overall security review not run against Supabase | Verify deployed headers; apply/inspect database policies; implement auth/write-path protections, rate limiting, monitoring, backup/restore drills |
| SEO and search privacy | `index.html`, `rentals.html`, `rental.html`, `owners.html`, `rental.js`, `robots.txt`, `api/sitemap.js`, `vercel.json` | Inspect canonical/OG metadata, sitemap and robots; confirm unpublished listing slugs never enter sitemap/API | **Partial**; static metadata and public-only sitemap logic are implemented and sitemap fallback is tested; Vercel rewrite and crawler behavior are not deployed/verified | Confirm production domain, verify Vercel rewrite and crawler behavior; listing metadata is set in browser JavaScript rather than server-rendered HTML |
| Privacy-conscious analytics | No event collector or analytics configuration found | Verify consent/legal basis and compare event counts to real server records | **Not implemented** | Select privacy-reviewed analytics and define retention/access controls |
| Local automated handler checks | `tests/api.test.js` | Run `node --test` and syntax/diff checks | **Passed locally: 7/7 handler tests; JavaScript syntax and `git diff --check` clean** | These use mocked Supabase responses; live database, provider and browser integration tests remain separate |
| End-to-end category booking journey | No bookable checkout flow exists | Exercise stay, drive, play/technology and experience; unavailable, invalid-date, cancelled, payment-failed, insufficient-permission and concurrent cases | **Not runnable** because booking/payment journeys do not exist | Implement backend lifecycle and sandbox providers, then run each scenario before enabling checkout |

## What this checkout can safely claim

- It can serve a customer-facing catalogue backed by approved, published Supabase listing rows once the migration and environment are configured.
- It can ask the database whether configured date capacity appears available. This is a read-only check; it creates no hold, request or reservation.
- The package builder is a browser-local draft. It does not submit a booking, guarantee availability or calculate fees/taxes or a combined checkout total.
- No completed payment, refund, payout, email, identity verification, owner approval or legal compliance is established by this code.

## Release decision

**Not production-ready for marketplace transactions.** Keep booking and payment calls disabled until the lifecycle, concurrency controls, permissions, provider callbacks, reconciliation, notifications, privacy/legal work and end-to-end acceptance scenarios above are implemented and pass in the intended production configuration. A successful page load or Vercel deploy is not sufficient evidence.
