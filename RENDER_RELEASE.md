# Render migration release — 2026-10-31

## A. Infrastructure removal — COMPLETE

Removed `infra/intelligence.yaml`, `services/intelligence/lambda_entry.py`, the Mangum runtime dependency, the IAM-specific authentication branch and its tests. No AWS resources, S3 objects, cloud secrets or user records had been provisioned by this implementation. There was no deployed data migration or account deletion. All unrelated marketplace requirements remain in `IMPLEMENTATION_STATUS.md`.

## B. Render implementation — COMPLETE for hosting

Real URL: **https://lockd-intelligence.onrender.com**

Render service: `srv-dbj35n942hec73bthgng`, Free Python web service, Frankfurt, 0.1 CPU / 512 MB. Source: `dirtydawkins/lockd2`, branch `codex/marketplace-foundations`, service code commit `5d66588`. Root `services/intelligence`; Python `3.12.12`; pinned requirements/constraints; Uvicorn on `$PORT`; one worker; health `/health`; manual deploys. The initial deploy and a subsequent clean deploy both reported live. Latest observed live deploy: `dep-dbj3798u01pc73ebvmm0`.

`render.yaml` reproduces the service settings. No database, disk, cron, private service, dedicated worker, paid networking, paid monitoring or scaling was created. Public Git source was used without granting a new GitHub app access to the user's repositories.

## C. Supabase integration — preserved / PARTIALLY COMPLETE

The existing Supabase project remains the only database and persistent object store. This hosting amendment adds no SQL migration, data copy, bucket, user database or new Supabase project. Existing listing storage and authorization are unchanged. There was no implemented object-storage integration or model artifact to transfer.

The previous reservation migration 0008 remains **pending live application**. The intelligence service is stateless and currently receives no live marketplace facts. Its backend client is implemented and tested locally, but production caller credentials and authorized live persistence of assessments are not connected. Future model/evidence artifacts require private Supabase buckets with reviewed access, retention, file size and plan limits; none are represented as already deployed.

## D. Security — implemented and locally verified

- Strong bearer credential on every `/v1/` request, including unsupported methods; constant-time comparison and configuration-failure denial.
- Streamed and declared request bodies capped at 8 KiB; strict field/type validation.
- Best-effort per-process 120-request/minute budget with 429/Retry-After. It resets with the process and is not a durable fraud ledger.
- Correlation IDs and sanitized structured logs; no request facts, tokens or passwords logged by the application.
- No browser CORS grant, API docs disabled, no-store responses, no filesystem persistence, no autonomous booking/payment authorization.
- Backend client restricts destination to configured HTTPS Render hosts, refuses redirects, and allows two requests of at most 1.5 seconds each before explicit unavailable state. No artificial keep-alive polling.

The first generated credential appeared in the browser tool's accessibility trace despite masking. The owner confirmed replacement in Render; a clean deploy followed. Its value was not committed to source or placed in frontend code. The replacement was not read or copied back into the conversation. Independent comparison proving revocation of the original value was not performed.

## E. AI functionality — PARTIALLY COMPLETE

Working: deterministic advisory handling of supplied verified unresolved incidents and policy-required identity verification, versioned results, neutral missing-data behavior. No credit check is performed; no booking is authorized. There are no trained models, image classifier, duplicate-image detector, recommendation ranking model, production reliability score, completed review/appeals workflow or C++ module. These requirements remain unfinished, not removed by the hosting change.

## F. Cost — Free verified

Preflight in the actual workspace: Hobby, no card, no pending charges, 0/750 free instance hours, 0/5 GB included outbound bandwidth and 0/500 pipeline minutes used. The service creation form was changed from its paid default to **$0/month Free**, and the created service displays Free. No card or paid upgrade was submitted.

These allowances are workspace-wide and usage accrues after creation. Free services sleep after 15 idle minutes, may need about one minute to resume, and lose filesystem changes. Without a payment method, exhausted bandwidth/build allowances suspend services/builds instead of purchasing additional usage. Do not add billing or paid resources without separate approval. See https://render.com/docs/free (read in the inbuilt browser). Free hosting is not a production availability guarantee.

## G. Verification

- `node --test --test-reporter=spec`: **68 passed**, including the existing PostgreSQL integration tests and three new backend client tests.
- Isolated dependency installation using pinned runtime requirements/constraints: succeeded; `pip check`: no broken requirements.
- Isolated `python -m unittest -v`: **8 passed**, including authentication, missing config, rate limiting, oversized/chunked input and no-secret-log checks.
- `python -m compileall -q app.py`: passed.
- `npm audit --audit-level=high`: zero vulnerabilities reported.
- `pip-audit -r requirements.txt`: no known vulnerabilities reported. These scans do not prove complete security.
- Blueprint parsed locally; free-only settings checked against Render's current documented fields; actual Render Python build succeeded.
- Local Windows import/RSS: **1.612 seconds / 40.2 MiB**. Observed Render command-to-startup interval: about **9 seconds**. No claim of measured Render RSS or cold-start recovery after a full idle sleep.
- Live browser: `/health` returned `status: ok`, `/ready` returned `status: ready`, unsigned `/v1/risk/assess` returned `Service authentication required`.
- **NOT VERIFIED**: authenticated live inference with the replacement token, native multi-connection booking concurrency, live Supabase reservation writes/RLS, complete idle-sleep/recovery test, payment sandbox journeys and CI results on GitHub.

## H. Deployment

GitHub implementation branch is pushed. Render is live using service code `5d66588`; later documentation/CI-only commits do not require a service rebuild because auto-deploy is Off. Vercel's existing production `main` deployment was not modified by this infrastructure amendment. No new live SQL or storage policies were applied. Core transactions remain independent of this advisory service.

## I. Remaining blockers

Protected live marketplace caller integration requires securely configuring its server-only credential, deriving facts from authorized Supabase records and verifying the call without exposing the token. Merchant accounts/onboarding for Daraja and Flutterwave, their integrations and sandbox verification, financial ledger/refunds/payouts, full booking lifecycle, operational monitoring, durable jobs, policy configuration and qualified legal review remain outstanding. The marketplace is not declared production-ready for financial transactions.
