# LOCKD trust implementation — 1 November 2026

Persona registration and domain/email purchase were explicitly deferred by the owner. No domain, mailbox, Persona account, payment account, paid resource or production verification has been created by this increment. Apple sign-in remains removed.

## Dependency map

Existing Supabase Auth → existing listing/availability records → reservation migration 0008 → versioned verification policy and reusable passport (0009) → independent owner/platform approvals and customer conditions → payment-provider integration **still missing** → two-party condition records and handover/return (0010) → dispute/appeal and operational resolution → in-app updates. No advisory inference result can authorize payment or a reservation.

Persona sandbox credentials + private database credential + approved webhook/template configuration → signed minimal event receipt → durable leased job (0011) → authoritative inquiry retrieval → sandbox passport metadata. Sandbox never satisfies a production verification gate. Creating/resuming inquiries has an adapter; the customer-facing hosted-inquiry launch flow is **not wired** and remains unavailable. No live provider call has been tested.

Verified outcomes + approved data-use/retention policy + adequate dataset + isolated training compute → model training/evaluation → human-approved registry/promotion/rollback. **These ML pipeline components are not implemented.** No trained model, accuracy claim, credit score, fraud score or universal trust score exists.

## Files and database changes

- `supabase/migrations/20261101_0009_lockd_trust.sql`: immutable policy versions, privately reviewed replacement values, append-only verification metadata, approval gates, preserved policy snapshots for confirmed contracts, approval renewal, customer condition acceptance and private audit records.
- `supabase/migrations/20261101_0010_lockd_operations.sql`: versioned condition summaries with independent acknowledgements, handover/return guards, disputes, a bounded appeal, independent case decisions, separate returned-item finalization, persisted in-app notifications and operational counts from real database records.
- `supabase/migrations/20261101_0011_lockd_identity_jobs.sql`: authenticated attempt references and consent versions, service-only inquiry binding, idempotent minimal webhook receipts, leased jobs, bounded retries/dead-letter state, fencing and out-of-order result handling.
- `api/trust.js`, `api/bookings.js`: bounded, authenticated API routing using the existing caller JWT; server functions enforce ownership and administrator permissions. No service-role key is used by the customer API.
- `trust.html`, `trust.css`, `trust.js`, `account.html`, `bookings.js`: account links, rental-specific requirements, owner/customer actions, condition records, notification inbox, dispute/appeal forms and an administrator control centre. The admin UI reads `app_metadata`; the database independently checks the signed role. User-editable metadata never grants access.
- `services/intelligence/persona.py`, `app.py`, `test_persona.py`, `.env.example`: sandbox-only integration contract, raw-body HMAC validation, durable receipt before acknowledgement, one-job reconciliation and configuration gates. No new runtime dependency.
- `tests/trust-db.test.js`, `tests/trust-api.test.js`: PostgreSQL and API security/lifecycle coverage. `tests/trust-preview.cjs` is an isolated browser fixture, not a production identity system. `tests/build-native-qa.cjs` generates private-schema concurrency fixtures; all test code/data is excluded from Vercel.

Migrations are additive and preserve historical records. They depend on the existing catalogue/profile migrations and 0008. No existing real profile, listing or reservation was replaced. The release record must state separately whether migrations have been applied live.

## Acceptance register

“Locally verified” means actual PostgreSQL/PGlite functions or isolated browser fixtures; it does not claim live Supabase authentication or provider connectivity.

| # | Requirement | Status and evidence / dependency |
|---|---|---|
| 1 | Repository audit | COMPLETE: existing Vercel HTML/JS, Supabase identity/catalogue, reservation engine and Render service reused; initial working tree clean. |
| 2 | Files created | COMPLETE: implementation and tests listed above. |
| 3 | Files modified | COMPLETE: existing account, booking and FastAPI entry points extended. |
| 4 | Database migrations | COMPLETE locally: 0009–0011 exercise actual PostgreSQL functions. No arbitrary production monetary threshold is seeded. |
| 5 | Applied migrations | NOT VERIFIED for production; see release evidence below. |
| 6 | Persona | PARTIALLY COMPLETE: official-contract adapter, signature/replay checks, durable receipts/reconciliation tested with synthetic responses. Account, template, credentials, hosted customer launch and actual sandbox journey deferred. Production mode deliberately refused. |
| 7 | Credit providers | BLOCKED: no approved provider access, contracts, authorized API contract or legal basis. No endpoints or scores invented; no bureau adapter implemented. |
| 8 | Utility bills | PARTIALLY COMPLETE: policy can request address review, reusable passport supports an authorized human decision and private evidence-system reference. Utility-bill extraction, evidence recommendation and bill validation are not implemented. |
| 9 | Encrypted PDFs | BLOCKED: uploads/parser/isolated processing worker are not implemented. A maintained parser, malware scanner, encrypted temporary handling, resource limits, explicit consent, cleanup and retention approval must precede uploads. |
| 10 | M-Pesa statements | BLOCKED: no financial document is collected or processed. Customer-password handling and statement processing are not implemented. |
| 11 | Document AI | BLOCKED: OCR/classification/anomaly workers and a validated corpus are not implemented. No claim of document authenticity is made. |
| 12 | Rental risk models | PARTIALLY COMPLETE: existing explainable deterministic advisory rules remain. No trained return-risk, survival, graph, expected-loss or CV model exists. |
| 13 | Fraud detection | PARTIALLY COMPLETE: authorization, rate/body limits, idempotency, ownership checks, version/lease fencing, booking capacity and manual review gates; no trained fraud/payment-anomaly detector. |
| 14 | Owner reliability | PARTIALLY COMPLETE: real operational counts and immutable event foundations. Reliability features, validated labels and owner-specific models are not implemented. |
| 15 | Dual approval | PARTIALLY COMPLETE: locally tested independent states, rejection, expiry, renewals and server-side progression gates. Live authorized customer/owner/admin journey outstanding. |
| 16 | Verification passport | PARTIALLY COMPLETE: immutable metadata, environment separation, expiry, revocation, per-rental age checks and private summaries tested locally. No raw KYC images or biometrics retained. |
| 17 | Payment/deposits | PARTIALLY COMPLETE: existing server-calculated rental/deposit separation retained; policy minimum deposit rejects insufficient listings without inventing a charge. Daraja/Flutterwave, callback/reconciliation/ledger/refund/payout implementation remains incomplete. |
| 18 | Device handover | PARTIALLY COMPLETE: both-party versioned condition acknowledgements and paid/approved/date gates tested. Photograph evidence, OTP codes and actual physical operations not implemented/verified. |
| 19 | Return tracking | PARTIALLY COMPLETE: both acknowledgements, overdue operational count and returned-item finalization tested locally. Damage media and automatic reminders not implemented. |
| 20 | Disputes | PARTIALLY COMPLETE: persisted case, private history, independent decision, one appeal and separate return finalization tested; no automatic refund or release from a case decision. Financial settlement and further escalation still need approved operations policy. |
| 21 | Autonomous agent | PARTIALLY COMPLETE: durable leased Persona jobs can be processed one at a time. No unattended scheduler or autonomous training agent is deployed. |
| 22 | Training automation | BLOCKED: no implemented training pipeline, approved data-use policy or verified training corpus. No synthetic production training or fake results. |
| 23 | Model evaluation | BLOCKED: no trained candidate or evaluation pipeline. |
| 24 | Drift monitoring | BLOCKED: no approved model, reference dataset or drift pipeline. |
| 25 | Model approval | BLOCKED: model registry/promotion workflow is not implemented. No code path promotes an advisory model. Human rental review is a separate implemented function. |
| 26 | Rollback | PARTIALLY COMPLETE: disable switches and Vercel/Render commit rollback procedure exist; approved-model rollback is not implemented. Database changes are forward-only; do not erase audit/financial records to roll back code. |
| 27 | Admin dashboard | PARTIALLY COMPLETE: policy versions, real review queue, manual verification, reviewed value, disputes and operational counts implemented and browser-tested against isolated SQL fixtures. Production administrator bootstrap and live permissions still need verification. |
| 28 | Security | PARTIALLY COMPLETE: RLS and revoked direct client grants, explicit authenticated RPCs, independent signed-admin checks, private audit tables, body limits, no raw webhook retention, no client-controlled prices/payment states, fenced retries, no secret logging. Distributed edge abuse controls and recovery/retention operations remain outstanding. |
| 29 | Privacy/legal | BLOCKED: Kenyan data protection, cross-border KYC processing, consumer/rental terms, CRB access, retention/deletion and training legal basis require qualified review. No compliance claim. |
| 30 | Tests | See dated execution evidence below. Provider/network tests use explicit synthetic fixtures. |
| 31 | Vercel | NOT VERIFIED for this increment; record exact commit/preview/production status below. |
| 32 | Render | Prior Free service exists; new integration code deployment is NOT VERIFIED until its health response contains `integration_contract_version: trust-1`. Credentials remain absent/disabled. |
| 33 | GitHub | Record commit/push/CI below; do not infer deployment from a successful push. |
| 34 | Credentials | Persona account/template/environment/API/webhook secrets; Render-only Supabase service credential; verified Vercel-to-Render caller secret; payment/bureau/email providers still needed. Never paste these into chat or public code. |
| 35 | Real data | No real inventory or bookings were present at live preflight. Training, calibration, loss estimates and provider/model performance cannot be measured. |
| 36 | Operations | Deployment and disabled-provider instructions follow. In-app notifications are persisted; no email/SMS sending or delivery is claimed. |

## Verification executed

- `npm test`: 96 Node tests passed in the final release pass; covers existing catalogue/auth/owner/booking functionality plus trust gates, condition versions, disputes/appeals, payment-state preservation, notifications, identity ownership, sandbox separation, stale results and leased retries.
- `services/intelligence/.venv/Scripts/python.exe -m unittest -v`: 16 Python tests passed, including 8 new Persona tests. Existing Starlette/httpx deprecation warning remains; no test failure.
- `npm audit --audit-level=high`: zero vulnerabilities reported. Runtime Python dependencies unchanged.
- `node --check trust.js` and `node --check api/trust.js`: passed.
- Inbuilt browser: desktop admin policy/review queue, platform decision persisted, customer isolation, notifications, marking an update read; 390px mobile layout and policy creation passed without horizontal overflow. No console errors observed. These were explicitly labelled local fixtures, not live Supabase accounts.
- Reduced-motion CSS is implemented; an actual OS reduced-motion preference and real-device performance have not been tested. Existing site has no dark-mode switch; none is claimed.
- Native Supabase PostgreSQL: migrations 0008–0011 compiled in `lockd_qa_20261101_ab3f`, with synthetic identities instead of `auth.users` and no `public.*` table references. Two independent SQL Editor connections ran competing requests while the first transaction held its reservation open for 35 seconds. Results: `first reservation committed`; `competing reservation rejected`, `booking_count=1`. This supplements single-connection PGlite tests. The private test schema has RLS enabled, and cleanup is pending. Production preflight still had zero listings/bookings and no reservation/trust foundation. No production booking switch was enabled.
- Live administrator preflight: zero `app_metadata.role=admin` users, and exactly one existing Auth user matches the owner's approved Gmail address. Assigning that account a privileged administrator role requires explicit authorization; profile fields cannot grant it.

## Deployment and operation

1. Review backup/recovery, apply 0008–0011 in sequence to staging, then verify native concurrency and actual authenticated roles. Apply production migrations only with required authorization. Do not rerun the forward migrations against already-created tables.
2. Keep `lockd_booking_settings.requests_enabled=false` and Vercel `LOCKD_BOOKING_REQUESTS_ENABLED=false` until the complete transaction/payment and policy dependencies are accepted. Public browsing remains available.
3. A production administrator must have server-managed `app_metadata.role=admin`. Never let a profile form assign it, and never grant it to an arbitrary customer or an owner to bypass review. A reviewer cannot approve their own rental or verify their own identity.
4. Configure policies through the control centre using approved business rules. Unknown replacement values fail closed when a value threshold applies. Pending requests use current rules; confirmed contracts retain their agreed policy version and require fresh approvals/evidence at handover.
5. A dispute decision does not issue money or prove a return. After a case decision and both return acknowledgements, an independent operator may finalize the returned item. Financial settlement remains a separate, unfinished operation.
6. Persona is optional/deferred. `services/intelligence/.env.example` documents private Render environment variables. Leave `PERSONA_ENABLED=false`. There is no customer launch button to imply that a hosted verification is available.
7. After authorized sandbox configuration, enable only `PERSONA_ENVIRONMENT=sandbox`; the adapter requires the expected `Persona-Environment-Id` response header, template ID, approved validity period and webhook secrets. Configure a minimal attribute allowlist at Persona so no documents/PII enter webhook bodies. Endpoint: `/webhooks/persona`; raw body limit 256 KiB, signed delivery tolerance 5 minutes. Rotate with both secrets supported. Store the private database key only on Render.
8. A signed event is acknowledged only after the receipt commits. Execute authenticated `POST /v1/jobs/persona/reconcile` to process **one** leased job. There is no free always-on worker/cron or hidden keep-alive job. An authorized scheduler is a remaining dependency. Retries and dead-letter state are durable in Supabase, not the ephemeral Render filesystem. Inspect jobs through a trusted operator; no secrets/body payloads belong in logs.
9. Sandbox evidence cannot approve production rentals. Completing an inquiry is not an approval; only authoritative `approved` becomes a sandbox verified record, and an outstanding manual revocation still requires human review. A production integration requires a separate reviewed release, not just changing a key.
10. No document-upload or financial-statement password UI is enabled. Implement private quarantine, scanning, consent, bounded isolated processing, cleanup, evidence-access audit and approved retention before enabling those features.
11. No paid resources, AWS, model downloads, provider transactions or account registrations are needed to deploy the disabled code. Leave payment collection disabled and never manually mark real bookings paid to make a flow look complete.

Official Persona contracts inspected in the inbuilt browser: [webhook signatures, rotation and ordering](https://docs.withpersona.com/2026-09-29/webhooks-best-practices), [create inquiry](https://docs.withpersona.com/api-reference/inquiries/create-an-inquiry), [resume inquiry](https://docs.withpersona.com/api-reference/inquiries/resume-an-inquiry), [inquiry approved event envelope](https://docs.withpersona.com/api-reference/webhooks/inquiry-events/webhook-inquiry-approved). No connectivity claim follows from reading documentation.
