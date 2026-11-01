# Marketplace access and sandbox verification — 2 November 2026

This is an implementation and acceptance register, not a production certification.
No fictional users, inventory, statements, bookings, conversations or provider results were created.

## Existing architecture audited

The site is the existing buildless HTML/CSS/JavaScript marketplace, with twelve Vercel handlers, caller-JWT Supabase RPCs, one Auth identity, private Storage, and the existing Render FastAPI service. Existing migrations 0008–0017 already supplied reservation, trust, identity-job, document-queue and ciphertext messaging foundations. Listing publication does not require Persona. There is currently no integrated customer payment processor despite earlier briefs referring to payment providers as though configured.

The lister workspace opens with the actual existing account, restores the session and presents the existing six-step form. The catalogue has no genuine published assets yet. A complete publication journey cannot be verified without real asset details, ownership, photos, rates and availability. Supplied editorial photographs were not converted into fake inventory.

## Implementation and actual verification

| Capability | Location | Actual result / dependency |
|---|---|---|
| Existing-account lister access | `owners.js`, `owner-guided.mjs`, migrations 0018–0021 | Live signed-in workspace and real empty catalogue verified in the inbuilt browser. No second login system. Full publication/edit/pause needs a genuine asset. |
| Existing-account message access | `messaging-device.mjs`, `messages.mjs`, migration 0022 | Database release enabled after internal source review. Actual signed-in inbox opens, with no key setup or invented conversations. No two-party send/read test performed without genuine inventory and a consenting counterparty. |
| Encryption / authorization | Existing OpenPGP v6, Curve25519 and AES-256-GCM modules, participant RPC/RLS | Existing protections retained. No server decryption key. Key changes remain pinned and flagged. This is not Signal protocol, forward secrecy or an independent crypto audit. |
| Reports / blocking | `api/messages.js`, `messages.mjs`, migration 0022 | Concerns can be recorded using category and selected real message references without an investigator key or disclosure of text. Optional encrypted disclosure remains supported only when a reviewer key is genuinely configured. Record-dependent report/block tests not run. |
| Message retention | Migration 0022 | Native hourly pg_cron job registered for 90-day text-content expiry, bounded batches of 1,000. History/RLS also enforce expiry. Actual job registration verified; an aged-message deletion was not simulated. Conversation/report metadata remains under operational retention review. |
| Chat attachments | Existing encryption/storage foundation; migration 0022 capability | Disabled until private object cleanup and retention are operational. Controls hidden; server reservation refuses disabled uploads. Existing implementation is preserved. |
| Unified verification cases | Migration 0023, `lib/verification-api.js` | Added sandbox-only orchestration reusing real booking IDs, Auth, document storage/queue/corrections and audit. Intake remains off and no sandbox members were enrolled. |
| Booking / consent checks | Migration 0023 | Subject ownership, eligible booking state, genuine policy requirements, purpose-specific consent, explicit separate credit consent and replay keys are enforced on the server. No production passport/booking/payment writes from new cases. |
| Utility photographs | Existing isolated parser, `documents/fields.py`, `providers.py`, migrations 0014/0023 | JPEG/PNG/WebP only, signature/decoding/dimension limits and existing scanner boundary. Added postal/meter/amount/currency fields and textual issuer registry. Tesseract/scanner configuration and genuine authorized bills remain required. No issuer verification API or calibrated forgery model claimed. |
| M-Pesa / bank parsing | `documents/financial.py`, isolated worker | Shared conservative labelled-column parser and source references. Missing/unreadable values stay absent. No genuine authorized statement has been supplied; no bank-format compatibility is verified. Unsupported layouts require review. |
| Financial arithmetic | `documents/financial.py`, worker booking context | Decimal totals, monthly inflows/outflows, coverage, duplicate/conflict handling, linked reversals, balance checks and advisory comparison with database-derived booking obligation. No salary, disposable-income or official-credit-score inference. Scalar arithmetic/invalid-input checks passed; real-statement accuracy not verified. |
| Password-protected statements | Isolated parser/password pipe | Private in-memory password parameter exists; no password is stored or logged. A complete authenticated unlock/retry API and UI are not implemented. Do not enable encrypted-statement intake on this basis alone. |
| Corrections / review / appeal | Migration 0023, `verification-workflow.mjs` | Original extraction and separate versioned corrections retained; optimistic versions, other-reviewer rules, withdrawal, expiry, revocation and one appeal. Provider-dependent completion remains blocked rather than faked. Sandbox reviewer membership and genuine cases required for end-to-end tests. |
| Creditinfo / Metropol | `peleza.py`, authenticated internal credit route, migration 0023 | Official sandbox OAuth and individual-CIR contract implemented, approved test-ID allowlist, purpose/consent checks, durable request references and no blind retries after unknown outcomes. No fabricated endpoint or score. Peleza signup actually rejected Gmail; account/approved purpose/credentials remain blocked by work email. Result interpretation, reconciliation and full bureau review remain incomplete. |
| Persona | Existing `persona.py` / identity jobs | Explicitly deferred. New common cases do not bypass existing identity decisions. No account, live provider verification or automatic financial eligibility claimed. Full orchestration linkage still requires integration work when Persona is available. |
| KRA | Intake wrapper, UI/API/classifier changes | Removed from active intake and source adapter; legacy records preserved. No KRA network calls. |
| Daraja account | User-created LOCKD Sandbox app | User confirmed mobile registration and app creation. Consumer credentials belong only in existing Render private environment as `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_ENVIRONMENT=sandbox`. No credentials in chat/GitHub. |
| Daraja authorization | `daraja.py`, existing Render app | Sandbox-only fixed-origin OAuth check; startup logs only boolean verification and never tokens. Actual success must be observed after the user configures credentials and deploys this commit. STK collection, callbacks, reconciliation/refunds/payouts are not implemented or enabled. |
| Paystack | Official test-account registration prepared | Real name/LOCKD/Gmail/Kenyan phone form prepared. User must choose accurate business details, create password, accept agreements and finish verification. No account or integration success claimed. |
| Other payments / eligibility | Existing booking/trust gates | Customer payment collection and new reservation requests remain off. No Binance/EVM/Solana settlement, fabricated ledger or automatic release was added. Production financial/verification activation requires separate operational/provider/legal readiness. |

## Safe checks completed before release

- `npm test`: 15 read-only source/asset/security checks passed.
- All 23 migration files parsed with pglast 8.7; Python modules compiled.
- `scripts/check-verification.py`: five read-only/scalar/boundary checks passed, without invented statements or provider responses.
- Actual local ASGI health and three unauthenticated internal-operation denials passed, without database writes or provider calls.
- Existing location/privacy release: all 15 actual production map/place/PostGIS/private-data checks passed. Successful hardware GPS fix remains unverified; actual timeout/manual fallback was tested earlier.
- Actual Supabase migrations 0022 and 0023 applied successfully in the inbuilt browser. Audit: messaging enabled, attachments off, sandbox intake off, zero sandbox members, zero LOCKD tables without RLS, anonymous credit execution denied, legacy worker bypass denied, one active retention job.
- Inbuilt browser: actual account restored into lister workspace and inbox. Real empty states preserved. No fictional end-to-end business records were created to turn blocked checks into passes.

## External configuration and incomplete work

Persona and Peleza need business-email/domain access and provider approval. Document processing needs approved scanner/OCR/runtime/retention setup, genuine authorized documents and measured resource limits; no new paid infrastructure was provisioned. Complete secure PDF unlock, institution-specific parser validation, identity/credit orchestration/reconciliation, cross-document identity comparisons, calibrated authenticity analysis, full review journeys and live payment/lifecycle acceptance tests remain incomplete. These foundations must not be described as a complete production verification or payment system.

## Sources inspected

- https://docs.peleza.com/docs/api/authorization/
- https://docs.peleza.com/docs/api/credit-reports/
- https://developer.safaricom.co.ke/apis/Authorization
- https://supabase.com/docs/guides/cron/install
- https://support.paystack.com/en/articles/2125634

## Release status

Code validation and database application completed. GitHub CI, Vercel/Render release and final live checks are recorded below when observed; a local build or account form is not deployment proof.
