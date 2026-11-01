# LOCKD document and communication foundations — 1 November 2026

This is an implementation register, not a production-readiness claim. The latest user decision is to build foundations for real accounts and data that will be connected later, and expose only genuinely supported functionality in the customer UI.

## Release boundary

- Development branch: `codex/verification-messaging`.
- Implementation commits `d49c644` and `07b73e5` are pushed to the development branch and `main`. The source-only, gated release follows the owner's existing deployment authorization; it does not activate new collection, credentials or reviewed-policy flags.
- Marketplace checks passed for both increments: [41301067863](https://github.com/dirtydawkins/lockd2/actions/runs/41301067863) and [41301337226](https://github.com/dirtydawkins/lockd2/actions/runs/41301337226).
- The initial Vercel preview caught the Hobby plan's 12-function limit. Private original downloads now share the document API function, keeping the existing plan. Corrected preview [6K9nCaEXNPUSLKtULDMnrmY1oMMZ](https://vercel.com/orengo/lockd2/6K9nCaEXNPUSLKtULDMnrmY1oMMZ) and production [2r5U2ZTWW1Wcg2441wzUQrw4midE](https://vercel.com/orengo/lockd2/2r5U2ZTWW1Wcg2441wzUQrw4midE) were both verified **Ready** in the inbuilt browser for `07b73e5`.
- The preview has no Supabase environment configuration and accurately returns `catalogue_not_configured`; it cannot establish backend acceptance. Production account restoration was verified using the existing signed-in account, with Messages and Address evidence hidden, no horizontal overflow and no captured console errors in that check.
- Production `/api/listings` returned its actual empty catalogue (`items: []`, `hasMore: false`), independently of the unconfigured preview. No sample inventory was substituted. A screenshot of the real signed-in production account was saved locally as `tests/artifacts/lockd-release-account.jpg` and excluded from deployment.
- The preceding image/trust release was `3ed04eb`. Its production evidence is in `RELEASE_STATUS_20261101.md`; the subsequent source release above preserves those existing services and data.
- New migrations **0012 and 0013 have not been applied to production**. They are additive, preserve existing rentals/accounts, contain no sample customers, listings, conversations or verification evidence, and default to disabled capabilities.
- No KRA, scanning, identity-provider or investigator account was created. No paid resource was provisioned. No provider credential was invented or committed.
- Test fixtures and the duplicate legacy application are excluded from Vercel. Local fixture servers were stopped and their browser tabs closed at the user's request. No fixture was published to production.
- Customer entries for messaging, address evidence and communication reviews remain hidden until their backend capability is enabled. Account access, owner tools and rental discovery continue independently.

## Existing account and automatic encryption

`messaging-onboarding.mjs` reuses `LockdAccount.getSession()` on account, owner and callback pages. There is no separate message login or user-entered message password. Unconfigured foundations do not create keys or interrupt account browsing.

When messaging is enabled, `messaging-device.mjs` prepares an OpenPGP v6 Curve25519-family identity automatically and registers only its public key against the authenticated Supabase user. Private material is sealed in IndexedDB with a random, non-extractable AES-GCM wrapping key and authenticated account context. It is not derived from a user ID, email, login password or JWT. Atomic storage avoids competing tabs overwriting a private key.

`messaging-crypto.mjs` uses the exact vendored OpenPGP.js **6.3.2** distribution. Every message is signed and encrypted using a fresh AES-256-GCM session key protected by recipient public-key encryption. Tests decrypt actual OpenPGP session-key packets and compare their random key material. Message context binds the conversation, sender/recipient devices and client id. The database independently prevents duplicate submissions.

First contact keys use **trust on first use** from the authenticated participant registry. Known-key changes are flagged and sending pauses for confirmation. Optional code comparison remains available under conversation options. This does not provide key transparency or independent authentication of a first-seen server-supplied key.

The supported model is **one logical message identity per account**, with optional signed, expiring, recipient-bound OpenPGP transfer between trusted browsers. Linked copies cannot be revoked individually. There is no server recovery key. Losing all copies can make old history inaccessible. **Forward secrecy is not implemented. This is not Signal Protocol and no Signal-equivalent security guarantee is made.** The complete application integration and transfer design require independent cryptographic review before activation.

## Implementation and verification register

| Capability | Implementation | Verification performed | Status / dependencies |
|---|---|---|---|
| Reuse existing account | `account-service.js`, `messaging-onboarding.mjs`, `messaging-device.mjs` | Live account page restored the existing LOCKD account; automatic-device unit tests use the existing session only | Account reuse verified; new messaging not live |
| Automatic local private keys | `messaging-store.mjs`, `messaging-device.mjs` | Non-extractable key export denied, sealed private bytes, account-bound AAD, restoration, concurrent writes, revocation and rotation tests | Implemented; independent review pending |
| Authenticated message encryption | `messaging-crypto.mjs`, `vendor/` | Real browser-bundle ↔ Node OpenPGP interoperability; wrong recipient/signer, unsigned data and context-replay rejection; fresh AES session keys | Implemented; no forward secrecy or production guarantee |
| Genuine conversations | migration `0013`, `api/messages.js` | Listing-derived membership, thread deduplication, sender/device binding, outsider denial, admin ordinary-message denial | PostgreSQL/PGlite verified; production migration pending |
| History, search and retries | `messages.mjs`, `messaging-store.mjs`, `0013` | Cursor SQL, unique client IDs, encrypted local outbox; earlier local browser test persisted a signed conversation across reload and filtered messages | Implemented; final passwordless browser journey against real Supabase pending |
| Delivery and read states | `0013`, `messages.mjs` | Sender cannot acknowledge; recipient-only database acknowledgement; client decryption precedes delivery, visible rows precede read requests | Database tests passed; live Realtime receipt test pending |
| Realtime delivery | Supabase Realtime client **2.118.0**, `0013` publication/RLS | Integration code, token refresh callback, participant RLS, reconnect/poll fallback | Not verified against live Realtime; ordinary transport has no Render dependency |
| Native, simple messaging UI | `messages.html`, `messages.css`, `messages.mjs` | Inbox/conversation navigation, search, More menu with reply/copy/report, all seven widths; plain-language interface refined in browser | Layout tested; automatic-key changes need final real-data browser verification before activation |
| Encrypted attachments | `0013`, `api/messages.js`, crypto/client modules | Signature/type/size/hash, wrong signer, unauthorized download and send-before-upload tests | Implemented; real Storage/browser transfer pending |
| Safe attachment presentation | `messages.mjs`, CSP | Images use controlled blob URLs; PDF explicit download; object URLs revoked; no HTML/SVG/executables accepted | No server malware-scan claim for ciphertext; complete adversarial viewer/device tests pending |
| Voluntary message reports | `0013`, `api/messages.js`, `messages.mjs` | Explicit excerpt preview/consent, separate investigator-key encryption, server digest, selected-ID membership, audit, role checks | Implemented for text excerpts; investigator key/configuration pending |
| Investigator review | `communications-admin.mjs`, `trust.html`, `0013` | Database evidence isolation/access audit/status tests; investigator decryption implementation | Live investigator account/key and browser review test pending; no ordinary-chat backdoor |
| Blocking | `0013`, `messages.mjs` | Blocks prevent new writes without deleting history | Database tests passed |
| Supporting address cases | `0012`, `api/documents.js`, `verification.*` | Consent/version, no cross-account access, corrections, independent review, withdrawal, address-only passport, stale leases | Implemented; collection disabled pending policy/scanner/operational setup |
| Inclusive alternatives | address methods and reviewer workflow | Student pathway and persistence tested locally without a utility bill | No automatic rejection or fraud flag for missing bills; real corroboration remains a human/provider task |
| Document intake | `0012` private upload-only quarantine, `documents/safety.py` | Signature/size gates, missing scan fails closed, inaccessible quarantine, immutable upload paths | Malware scanner not configured; uploads disabled |
| PDF structural screening | `documents/analyze.py` | Embedded files, encryption, page/object bounds, annotations, typography observations, text bounding boxes | Operational deterministic observations; no fraud verdict or signature-chain verification |
| Images and OCR | `documents/analyze.py`, optional requirements | Real image decode, orientation handling, dimensions, low-detail flags, dHash; OCR subprocess/time/size bounds implemented | Tesseract and traineddata not provisioned; real image-text extraction not verified |
| Field extraction | `documents/fields.py` | Readable synthetic PDFs, masked account references, page/region provenance, conflicting fields, dates | Rules only; confidence is null when not validated, not fabricated |
| Address comparison | `documents/address.py` | Postal/residential separation, normalization, spelling variations, numeric differences, missing evidence | Supporting text similarity only; no geocoding or proof of residence |
| Duplicate evidence | SHA-256 database match count and image dHash | Identical-file hashes, minimized results and private analysis | Near-duplicate/copy-move matching not implemented |
| Asynchronous document work | `0012`, `documents/jobs.py`, isolated worker, internal FastAPI routes | Leased claims, stale-token denial, retries, scan-before-parse, process timeout, service auth | Real scanner, service credentials, scheduler and Render benchmarks pending |
| Retention/withdrawal | document deletion jobs and RPCs | Storage acknowledgement before purge; token fencing; withdrawal revokes matching address evidence | Document worker implemented; live scheduler/Storage deletion and approved retention/legal policy pending |
| KRA | `documents/kra.py` | Format/consent validation; unavailable status never verifies PIN or address | No approved API contract or credentials. Live transport/mapping is not implemented; no guessed endpoint |
| Eligibility | existing passport and rental gates | Address review affects only address evidence; identity, approvals, deposit and payment remain independent in regression tests | No opaque fraud score, financial-hardship inference or new automatic rental approval |
| Production surface | `.vercelignore`, capability gates, `tests/production-surface.test.js` | No synthetic/QA copy or separate message-password controls in root customer pages; fixtures/legacy duplicates excluded; actual Vercel packaging and live account gates checked | Source deployed; new database capabilities remain disabled/unapplied |

## Explicitly incomplete work

The following are not masked by decorative controls, mock results or success messages:

- Approved KRA GavaConnect registration, API contract, credentials and authorized live verification.
- Malware-scanner deployment, Tesseract provisioning, actual Render CPU/RAM benchmarks and a durable scheduled worker caller. No assumption that ClamAV fits Render Free is made.
- Representative lawfully sourced issuer templates, tampered-region localization, copy-move/compression/noise detectors, calibrated ML, training/evaluation datasets, precision/recall or drift measurements. No claimed model accuracy exists.
- Cryptographic PDF signature and certificate-chain validation.
- Privacy/processor/cross-border/retention/legal review and PyMuPDF licensing assessment. The optional PyMuPDF **1.28.2** and Pillow **13.0.0** worker dependencies are not enabled in the default Render build.
- Independent cryptographic application review, key transparency, forward secrecy and independently revocable multi-device sessions.
- Private Realtime typing/presence channels, real-device network/latency measurements and live Realtime/Storage testing.
- Attachment **contents** in report disclosures, investigator provisioning, full report-enforcement/appeal operations, message/attachment retention jobs and legal holds. Text-report UI explicitly excludes attachment contents.
- External email/SMS/push sending. Ordinary message ciphertext does not appear in server notifications.

These omissions block full acceptance of the original end-to-end briefs. The user has authorized building foundations while external accounts and real data are set up later; they do not justify exposing nonfunctional customer controls.

## Actual checks

- Latest complete Node run: **153 passed, 0 failed** (including actual PostgreSQL/PGlite behavior, OpenPGP interoperability and device-key tests).
- Latest complete Python run: **40 passed, 0 failed**. Fixtures are controlled synthetic documents for tests, not issuer authentication or ML validation.
- `npm audit --audit-level=high`: **0 vulnerabilities reported**.
- `pip-audit -r requirements-documents.txt --timeout 20`: **no known vulnerabilities found** after upgrading Pillow from 12.2.0 to 13.0.0. All 40 Python tests passed on the patched version. The earlier audit's Pillow findings were fixed, not ignored.
- JavaScript module syntax and `git diff --check` passed. Python dependency auditing is also configured in GitHub CI, including the optional document requirements.
- Earlier browser visual checks covered 320, 375, 390, 430, 768, 1024 and 1440 CSS pixels with no horizontal overflow, search filtering, More actions and mobile inbox navigation. The local fixture browser/server was then removed from the visible session. No synthetic preview is a final deliverable.
- New production migrations, new provider checks, actual private document uploads and the final passwordless live messaging journey have **not** been verified in production.

## Configuration boundary

`services/intelligence/.env.example` lists the existing internal secret/Supabase service connection and optional document switches. All credential values remain blank. `DOCUMENT_PROCESSING_ENABLED` and OCR remain false.

Messaging and address intake require their database capabilities and reviewed policies to be enabled by an authorized operator. Do not set `security_reviewed_at` or `policy_approved_at` as a substitute for the corresponding review. Realtime publications and Storage policies require validation on the actual project after an approved migration. Do not run test fixtures in production.

Official references actually consulted: [OpenPGP.js](https://docs.openpgpjs.org/), [KRA GavaConnect information](https://www.kra.go.ke/helping-tax-payers/facts-about-kra/category/13), [PyMuPDF page API](https://pymupdf.readthedocs.io/en/latest/page.html), [ClamD INSTREAM](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [Supabase Postgres changes](https://supabase.com/docs/guides/realtime/postgres-changes). The KRA developer portal did not expose an accessible approved API contract in this session.
