# LOCKD intelligence — Render Free

Architecture: Vercel serves LOCKD and trusted marketplace endpoints; the existing Supabase project owns identity, listing data, availability, bookings, financial records and private storage. Render runs this stateless FastAPI service. GitHub owns source and CI. No frontend redesign or transactional data migration is part of this amendment.

The previous cloud-specific template, handler, authentication branch and adapter dependency have been removed. None of that infrastructure was provisioned, so there is no deployed cloud resource or user data to migrate or delete.

## Deploy the single Free web service

- Repository: `dirtydawkins/lockd2`, branch `codex/marketplace-foundations`.
- Blueprint: repository-root `render.yaml`. Equivalent manual service settings: **Python 3**, **Free**, root `services/intelligence`, build `pip install --no-cache-dir -r requirements.txt`.
- Start: `uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1 --no-access-log --limit-concurrency 20 --timeout-keep-alive 5`.
- Python: `3.12.12`; pinned FastAPI, Pydantic and Uvicorn versions in `requirements.txt`.
- Health: `/health`; readiness: `/ready`. Readiness returns 503 when the service token is missing or shorter than 32 characters. No fake health check of external services is performed.
- Set `INTELLIGENCE_SHARED_SECRET` to a cryptographically random backend token of at least 32 characters. Generate/store it only after the owner's approval. Use Render's secret environment field; never commit it or put it in a URL. A restart is sufficient for rotation.
- Auto-deploys are disabled to control pipeline usage. Deploy a reviewed commit manually after CI passes. This also supports deploying from the public Git URL without granting additional repository permissions.
- Select no disk, database, private service, worker, cron, paid monitoring, paid networking or scaling. No external keep-alive or uptime-ping job is permitted.

Live deployment is **NOT VERIFIED** until the dashboard shows successful startup and a real service URL has passed health, readiness, unauthenticated denial and authorized rules checks. The repository does not invent a deployment URL.

## Cost preflight and limitations

Verified in the Render dashboard on 2026-10-31 before resource creation: Hobby workspace, no card on file, no pending charges; 0/750 free instance hours, 0/5 GB outbound bandwidth, and 0/500 pipeline minutes used. These are workspace-wide allowances and must be checked again before additional deployments.

The Free Web Service plan is eligible for this initial service. Official docs: https://render.com/docs/free and https://render.com/docs/blueprint-spec. Free services sleep after 15 idle minutes and can take about one minute to wake. Runtime files disappear on sleep, restart or redeploy. Free compute does not provide always-on production availability. The Free plan does not include dedicated free workers, cron, disks, private inbound networking or horizontal scaling.

Free hours exhausted: services suspend until the next month. Bandwidth/build overages can incur charges when a payment method is present; with no payment method, services/builds are suspended instead. Keep the workspace without a card and do not upgrade it. No paid resource has been authorized. A compute plan labelled Free is distinct from the workspace's Hobby plan.

## Authentication, limits and failure handling

All `/v1/` endpoints require the strong service bearer token. Constant-time comparison, request validation, an 8 KiB streamed-body cap, a process-local 120-request/minute budget, correlation IDs, no-store responses and sanitized structured logs are implemented. The process-local budget resets on restart and is not a durable fraud or accounting record. Rate failures return 429 with Retry-After. No CORS access is granted to browsers. API documentation endpoints are disabled. Uvicorn access logging is disabled to avoid logging untrusted URLs.

`lib/intelligence.js` provides a trusted-backend client using `LOCKD_INTELLIGENCE_URL` and `LOCKD_INTELLIGENCE_SECRET`. It permits only HTTPS Render hosts, rejects redirects, uses 1.5-second request deadlines, and allows at most two attempts. Cold starts return an explicit unavailable result with a suggested later retry. The client does not poll and never translates unavailable/invalid results into booking approval. It is not connected to live booking decisions, and it is excluded from the current buildless frontend upload until an authorized marketplace caller is added. No private token is exposed through `/api/config` or frontend environment names.

The token authorizes the internal service caller, not an end-user identity. The trusted marketplace backend must validate users and derive facts from its authorized records before invoking this service. Financial and booking state stays in PostgreSQL and must not depend on Render being awake. Bearer credentials require TLS, restricted operator access and rotation if exposed; no claim of durable replay prevention is made for this stateless advisory service.

## Data, algorithms and storage

The service stores nothing on its local filesystem. Its current deterministic rules identify supplied confirmed unresolved incidents for human review and report owner-policy identity requirements. Missing history is not treated as fraud. Results are advisory, identify their rules version and do not authorize bookings or claim a credit check. No trained ML model, computer-vision classifier, reliability score, bureau integration, recommendation ranking, human-review queue or durable assessment journal has been completed. Their requirements remain in the implementation register; this hosting change does not remove them.

Existing Supabase private listing storage is retained. No model, dataset or verification artifact currently needs migration, so no empty bucket or replacement database is provisioned. Future artifacts must use private Supabase buckets, server-authorized signed URLs, size limits and retention policies after checking actual free storage/bandwidth allowance. Do not place Supabase service-role credentials in this service unless a specific least-privilege integration has been reviewed and approved.

Durable jobs and assessment audit records must be stored in the existing Supabase database before background processing is enabled. In-memory tasks are not a queue and no background-work completion is promised across a restart. Manual review, payments, refunds, payout accounting, eligibility policy, storage authorization and bureau/legal approval remain separate unfinished dependencies.

## Verify, release and recover

1. Install `requirements.txt` in an isolated Python environment; install `httpx==0.28.1` for tests only.
2. `python -m unittest -v` in this directory; `python -m compileall -q app.py`.
3. Repository root: `node --test` (includes the PostgreSQL booking tests and backend timeout/fallback tests), plus dependency audits. Validate the blueprint against the currently documented fields.
4. Deploy the reviewed commit to Free compute. Check logs for startup failures; never copy tokens or private facts into logs or support messages.
5. Verify GET health/readiness, POST without a token (401), and POST with the configured backend token (200 and advisory-only result). A successful health response alone is not an authenticated integration test.
6. Do not schedule keep-alive requests. A cold-start timeout is an expected unavailable state, not evidence of payment/booking failure. Retest recovery after a normal later request when appropriate.
7. If a release fails, use a previous available Render deploy or redeploy the known-good commit. No local state requires restoring. Rotate an exposed service token in both authorized server environments and investigate access without deleting evidence.

Measurements and actual deployment outcomes are recorded in the release report; local startup/RSS measurements do not prove performance on Render's free instance.
