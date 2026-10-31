# LOCKD implementation register — 2026-10-31

## Preserved

Existing buildless HTML/JS, Vercel functions, Supabase identity, listing publication, category search, photography, favourites, Google PKCE sign-in and brand styling are retained. Apple remains intentionally removed under the owner's explicit instruction.

## Delivered in this increment

| Requirement | Location | Verification | Status |
|---|---|---|---|
| Server-calculated rental prices and separate deposits | migration 0008, `api/bookings.js` | PostgreSQL integration tests | PARTIALLY COMPLETE: KES/date-based periods only; hourly and partial billing periods fail closed |
| Reservation requests and idempotent retry | same | PostgreSQL tests and API tests | PARTIALLY COMPLETE: local; feature disabled pending staging |
| Inventory holds, expiration, cancellation, owner acceptance/rejection | migration 0008 | PostgreSQL tests | PARTIALLY COMPLETE: row locking implemented; native multi-connection concurrency test outstanding |
| Capacity protection during owner calendar edits | migration 0008 trigger | PostgreSQL delete-denial test | COMPLETE locally; not applied live |
| Customer/owner histories and listing snapshots | account UI, `bookings.js`, protected RPCs | SQL cross-account and no-direct-table-access tests | PARTIALLY COMPLETE: last 100 records; browser and live RLS verification outstanding |
| Booking event journal | migration 0008 | event retention test | COMPLETE locally; no client write privileges |
| Authenticated Python decision-support API | `services/intelligence/` | eight Python tests | PARTIALLY COMPLETE: actual deterministic rules; no model, no credit lookup, no marketplace invocation |
| Render Free web-service definition | `render.yaml`, `services/intelligence/README.md` | schema reference, dependency and startup checks | PARTIALLY COMPLETE: deployment verification recorded in the service README |
| CI checks | `.github/workflows/checks.yml` | local Node/Python runs | NOT VERIFIED on GitHub until pushed |

## External setup and remaining work

- **PARTIALLY COMPLETE**: Render replaces the previous compute provider. The existing Hobby workspace has no card, 0/750 instance hours, 0/5 GB bandwidth, and 0/500 pipeline minutes used at the 2026-10-31 preflight. Use one Free Python Web Service only, with no disk, datastore, worker, cron, paid plan or keep-alive job. Deployment status and limits are recorded in the service README. Supabase remains the sole transactional database and persistent object store.
- **BLOCKED**: Daraja and Flutterwave accounts do not yet exist. The owner must authorize each registration and complete merchant onboarding. Neither integration is implemented, sandbox tested or activated. Never enable a payment button until verified provider callbacks, independent reconciliation, ledger posting and reservation confirmation work together.
- **BLOCKED**: Native staging PostgreSQL access is needed for real concurrent transaction and full migration-chain tests. PGlite runs the actual PostgreSQL functions locally but is single-connection; it does not prove multi-connection behavior or live Supabase policy correctness.
- **PARTIALLY COMPLETE**: check-out, return and dispute state transitions exist, but condition evidence, dispute resolution, notifications, rescheduling, extensions and paid cancellation/refund policy are unfinished.
- **NOT VERIFIED**: live customer/owner reservation flows, live profile/saved isolation, SMTP delivery, refunds, payout accounting, financial ledger, reconciliation, provider abuse controls and backup/recovery remain outstanding.
- **BLOCKED**: legal review, approved rental/cancellation policies, commission/tax configuration, data retention, CRB access and customer consent. No credit score or trained ML model exists. No identity/financial scraping is used.
- The older `PRODUCTION_READINESS.md` describes the prior live release. This register records new local work and does not supersede unverified production limitations in that audit.

## Safe release and forward recovery

1. `npm ci`, `npm test`, `npm audit --audit-level=high`; `python -m unittest -v` from `services/intelligence`.
2. Apply migration 0008 to a staging clone after migrations 0001–0007. It preserves legacy booking rows and expands their allowed states. It creates no inventory and keeps requests disabled.
3. Run two actual concurrent connections against the last available unit. Verify owner edits cannot erase reserved capacity, RLS isolation, request retries after lost responses, price changes, cancellation and expiration.
4. Run customer and owner browser journeys with authorized staging accounts. Existing owner calendar editing will reject changes affecting reserved dates until reservations are resolved.
5. Apply the tested migration in production only after reviewing backup/recovery. Do not delete or rewrite historical bookings for rollback. Disable `lockd_booking_settings.requests_enabled` and `LOCKD_BOOKING_REQUESTS_ENABLED` to stop new requests; history and authorized cancellation remain accessible. Roll the frontend back via Vercel if necessary.
6. Keep both switches disabled until the unfinished transaction, payment and policy dependencies are resolved. Enabling reservation creation is a separate release decision.
7. Render deployment must follow `services/intelligence/README.md`: confirm the workspace's remaining usage, select Free compute, configure the backend-only credential, and verify public health plus unauthorized/authenticated API behavior. The service is advisory and may sleep; booking/payment authorization must continue without depending on it. No paid resource or upgrade is authorized.

## Incident response foundation

For suspected credential exposure, revoke the affected credential through its provider, preserve relevant audit records, and record scope/timestamps without copying tokens. Disable the affected integration and investigate before restoring access. For payment discrepancies, stop settlement, reconcile provider records, and preserve immutable evidence; do not edit balances to make reports agree. For account abuse, preserve booking/event records, restrict the affected identity through a trusted administrator, and review access logs. Recovery and legally required notifications need an operator and legal review; these procedures are not a claim of operational readiness.
