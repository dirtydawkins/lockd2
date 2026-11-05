"""Internal, deterministic decision support. No trained model or credit lookup."""
import hmac
import json
import logging
import os
import time
import asyncio
from contextlib import asynccontextmanager
from contextlib import suppress
from collections import deque
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, SecretStr
import persona
import peleza
import daraja
import paystack
import payments

logger = logging.getLogger("lockd.intelligence")

@asynccontextmanager
async def lifespan(application):
    for provider, environment, adapter in (('daraja', 'sandbox', daraja), ('paystack', 'test', paystack)):
        setattr(application.state, provider + '_authorization_verified', False)
        if adapter.configured():
            try:
                await asyncio.to_thread(check_payment_connection, application, provider, adapter)
            except (persona.IntegrationUnavailable, persona.InvalidProviderResult):
                pass
            logger.warning(json.dumps({'event': provider + '_' + environment + '_authorization',
                                       'verified': getattr(application.state, provider + '_authorization_verified'),
                                       'payments_enabled': False}))
    payment_worker = asyncio.create_task(reconcile_payments()) if paystack.reconciliation_enabled() else None
    try:
        yield
    finally:
        if payment_worker:
            payment_worker.cancel()
            with suppress(asyncio.CancelledError):
                await payment_worker


async def reconcile_payments():
    """Recover durable jobs while Render is awake; this is not an always-on SLA."""
    while True:
        try:
            result = await asyncio.to_thread(payments.reconcile_one)
            if result['state'] != 'idle':
                logger.info(json.dumps({'event': 'test_payment_reconciliation', 'state': result['state']}))
        except Exception:
            logger.warning(json.dumps({'event': 'test_payment_reconciliation_unavailable'}))
        await asyncio.sleep(60)

app = FastAPI(title="LOCKD intelligence", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
VERSION = "rules-1"
requests_in_window = deque(maxlen=120)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    # Pydantic's default errors may echo input, including an ephemeral password.
    return JSONResponse({'detail': 'Invalid request details'}, status_code=422,
                        headers={'Cache-Control': 'no-store'})


def check_payment_connection(application, provider, adapter):
    attribute = provider + '_authorization_verified'
    setattr(application.state, attribute, False)
    result = adapter.check_connection()
    setattr(application.state, attribute, result.get('authorization_verified') is True)
    return result

def shared_secret() -> str:
    return os.getenv("INTELLIGENCE_SHARED_SECRET", "")

def authorize(authorization: Annotated[str | None, Header()] = None):
    expected = shared_secret()
    if len(expected) < 32:
        raise HTTPException(503, "Service configuration unavailable")
    if not authorization or not hmac.compare_digest(authorization.encode(), f"Bearer {expected}".encode()):
        raise HTTPException(401, "Service authentication required")

class BodyTooLarge(Exception):
    pass

class BodyLimitMiddleware:
    """Bound streamed bodies, including requests without Content-Length."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        size = 0
        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            limit = 262144 if scope.get('path') in ('/webhooks/persona', '/webhooks/paystack') else 8192
            if size > limit:
                raise BodyTooLarge()
            return message
        await self.app(scope, bounded_receive, send)

@app.middleware("http")
async def guard_and_log(request: Request, call_next):
    correlation = str(uuid4())
    if request.url.path.startswith("/v1/"):
        try:
            authorize(request.headers.get("authorization"))
        except HTTPException as error:
            return JSONResponse({"detail": error.detail}, status_code=error.status_code,
                                headers={"Cache-Control": "no-store", "X-Request-ID": correlation})
    length = request.headers.get("content-length", "0")
    limit = 262144 if request.url.path in ('/webhooks/persona', '/webhooks/paystack') else 8192
    if not length.isdecimal() or int(length) > limit:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    try:
        await request.body()
    except BodyTooLarge:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    if request.url.path.startswith("/v1/"):
        # Best-effort process-local abuse control, not a durable security decision.
        now = time.monotonic()
        while requests_in_window and requests_in_window[0] <= now - 60:
            requests_in_window.popleft()
        if len(requests_in_window) >= 120:
            return JSONResponse({"detail": "Try again shortly"}, status_code=429, headers={"Retry-After": "60"})
        requests_in_window.append(now)
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.error(json.dumps({"event": "service_error", "correlation_id": correlation}))
        response = JSONResponse({"detail": "Intelligence service unavailable"}, status_code=503)
    response.headers["X-Request-ID"] = correlation
    response.headers["Cache-Control"] = "no-store"
    route = getattr(request.scope.get("route"), "path", "unknown")
    logger.info(json.dumps({"event": "inference_request", "correlation_id": correlation,
                           "route": route, "status": response.status_code,
                           "duration_ms": round((time.monotonic() - started) * 1000)}))
    return response

@app.get("/health")
def health():
    return {"status": "ok", "rules_version": VERSION, "trained_model": False, "integration_contract_version": "trust-1"}

@app.get("/ready")
def ready():
    configured = len(shared_secret()) >= 32
    if not configured:
        return JSONResponse({"status": "not_ready"}, status_code=503)
    return {"status": "ready", "rules_version": VERSION}

class RiskInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    # Only facts verified by the trusted marketplace backend belong here.
    confirmed_unresolved_incident: bool | None = None

@app.post("/v1/risk/assess", dependencies=[Depends(authorize)])
def assess_risk(facts: RiskInput):
    if facts.confirmed_unresolved_incident is True:
        decision, reasons = "manual_review", ["unresolved_verified_incident"]
    elif facts.confirmed_unresolved_incident is None:
        decision, reasons = "insufficient_data", []
    else:
        decision, reasons = "no_flags_in_supplied_facts", []
    return {"assessment_id": str(uuid4()), "rules_version": VERSION,
            "decision": decision, "reasons": reasons, "advisory_only": True}

class EligibilityInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    identity_required_by_policy: bool = False
    identity_verified: bool | None = None
    confirmed_unresolved_incident: bool | None = None

@app.post("/v1/rentals/eligibility", dependencies=[Depends(authorize)])
def assess_eligibility(facts: EligibilityInput):
    requirements = []
    if facts.identity_required_by_policy and facts.identity_verified is not True:
        requirements.append("identity_verification")
    if facts.confirmed_unresolved_incident is True:
        requirements.append("manual_review")
    return {"assessment_id": str(uuid4()), "rules_version": VERSION,
            "requirements": requirements, "advisory_only": True,
            "credit_check_performed": False, "booking_authorized": False}

app.add_middleware(BodyLimitMiddleware)

@app.post('/webhooks/persona')
async def persona_webhook(request: Request):
    if not persona.enabled():
        return JSONResponse({'detail': 'Identity integration unavailable'}, status_code=503)
    raw = await request.body()
    secrets = [os.getenv('PERSONA_WEBHOOK_SECRET', ''), os.getenv('PERSONA_PREVIOUS_WEBHOOK_SECRET', '')]
    if not persona.verify_signature(raw, request.headers.get('persona-signature', ''), secrets):
        return JSONResponse({'detail': 'Invalid signature'}, status_code=401)
    try:
        metadata = persona.event_metadata(raw)
        # Commit durable receipt before 2xx. No raw payload or provider status is persisted.
        from starlette.concurrency import run_in_threadpool
        await run_in_threadpool(persona.database_rpc, 'enqueue_lockd_identity_event', metadata)
    except persona.InvalidProviderResult:
        return JSONResponse({'detail': 'Invalid event'}, status_code=400)
    except persona.IntegrationUnavailable:
        return JSONResponse({'detail': 'Event storage unavailable'}, status_code=503)
    return JSONResponse({'received': True}, status_code=202)

@app.post('/v1/jobs/persona/reconcile', dependencies=[Depends(authorize)])
def reconcile_persona():
    try:
        return persona.reconcile_one()
    except (persona.IntegrationUnavailable, persona.InvalidProviderResult):
        return JSONResponse({'detail': 'Identity reconciliation unavailable'}, status_code=503)


@app.post('/webhooks/paystack')
async def paystack_webhook(request: Request):
    if not paystack.reconciliation_enabled():
        return JSONResponse({'detail': 'Payment event processing unavailable'}, status_code=503)
    raw = await request.body()
    if not paystack.verify_webhook(raw, request.headers.get('x-paystack-signature', '')):
        return JSONResponse({'detail': 'Invalid signature'}, status_code=401)
    try:
        # Durable receipt first; worker retrieves the authoritative provider status.
        result = await asyncio.to_thread(payments.receive, raw)
        return JSONResponse(result, status_code=200)
    except persona.InvalidProviderResult:
        return JSONResponse({'detail': 'Invalid event'}, status_code=400)
    except persona.IntegrationUnavailable:
        return JSONResponse({'detail': 'Event storage unavailable'}, status_code=503)


@app.post('/v1/jobs/paystack/reconcile', dependencies=[Depends(authorize)])
def reconcile_paystack():
    try:
        return payments.reconcile_one()
    except (persona.IntegrationUnavailable, persona.InvalidProviderResult):
        return JSONResponse({'detail': 'Payment reconciliation unavailable'}, status_code=503)

@app.get('/v1/integrations', dependencies=[Depends(authorize)])
def integration_capabilities():
    from documents.jobs import configured
    return {'persona': {'configured': persona.enabled(), 'environment': 'sandbox', 'live_verified': False},
            'credit': {'configured': peleza.configured(), 'environment': 'sandbox', 'live_verified': False}, 'documents': {'processing_configured': configured(), 'uploads_enabled': False, 'trained_model': False},
            'training': {'trained_model': False}, 'payments': {'configured': False,
            'daraja_sandbox_credentials_present': daraja.configured(),
            'daraja_sandbox_authorization_verified': getattr(app.state,'daraja_authorization_verified',False),
            'paystack_test_credentials_present': paystack.configured(),
            'paystack_test_authorization_verified': getattr(app.state,'paystack_authorization_verified',False),
            'test_reconciliation_configured': paystack.reconciliation_enabled(),
            'checkout_enabled': False, 'live_enabled': False}}

@app.post('/v1/jobs/documents/process', dependencies=[Depends(authorize)])
def process_document():
    from documents.jobs import process_one
    try:
        return process_one()
    except persona.IntegrationUnavailable:
        return JSONResponse({'detail': 'Document processing unavailable'}, status_code=503)

@app.post('/v1/jobs/documents/retention', dependencies=[Depends(authorize)])
def expire_document():
    from documents.jobs import delete_one
    try:
        return delete_one()
    except persona.IntegrationUnavailable:
        return JSONResponse({'detail': 'Document retention unavailable'}, status_code=503)


class StatementUnlock(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    document_id: str
    lease: str
    password: SecretStr


@app.post('/v1/documents/unlock', dependencies=[Depends(authorize)])
def unlock_statement(body: StatementUnlock):
    from uuid import UUID
    from documents.jobs import unlock_statement as unlock
    try:
        document_id, lease = str(UUID(body.document_id)), str(UUID(body.lease))
        password = body.password.get_secret_value()
        if not 1 <= len(password.encode('utf-8')) <= 1024 or '\x00' in password:
            raise ValueError()
        return unlock(document_id, lease, password)
    except ValueError:
        return JSONResponse({'detail': 'Choose a valid statement and password'}, status_code=400)
    except (persona.IntegrationUnavailable, persona.InvalidProviderResult):
        return JSONResponse({'detail': 'Statement processing unavailable'}, status_code=503)
    finally:
        password = None


class CreditInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    case_id: str
    provider: str
    approved_test_id: str


@app.post('/v1/integrations/daraja/check', dependencies=[Depends(authorize)])
def check_daraja():
    try:
        return check_payment_connection(app, 'daraja', daraja)
    except (persona.IntegrationUnavailable, persona.InvalidProviderResult):
        return JSONResponse({'detail': 'Daraja sandbox authorization is unavailable'}, status_code=503)


@app.post('/v1/integrations/paystack/check', dependencies=[Depends(authorize)])
def check_paystack():
    try:
        return check_payment_connection(app, 'paystack', paystack)
    except (persona.IntegrationUnavailable, persona.InvalidProviderResult):
        return JSONResponse({'detail': 'Paystack test authorization is unavailable'}, status_code=503)


@app.post('/v1/verification/credit', dependencies=[Depends(authorize)])
def credit_request(body: CreditInput):
    from uuid import UUID
    import re
    if not peleza.configured():
        return JSONResponse({'detail': 'Credit provider is not configured'}, status_code=503)
    try:
        case_id = str(UUID(body.case_id))
        if body.provider not in ('creditinfo', 'metropol') or not re.fullmatch(r'\d{6,10}', body.approved_test_id) or body.approved_test_id not in os.getenv('PELEZA_APPROVED_SANDBOX_IDS', '').split(','):
            raise ValueError()
    except ValueError:
        return JSONResponse({'detail': 'Approved sandbox case and identity required'}, status_code=400)
    try:
        # The DB verifies subject membership, genuine booking, current policy and separate credit consent.
        job = persona.database_rpc('claim_lockd_credit_request', {'p_case_id': case_id, 'p_provider': body.provider})
        if job.get('state') != 'claimed':
            return {'state': job.get('state'), 'retry_allowed': False}
        reference, outcome = None, 'unknown'
        try:
            result = peleza.individual(body.approved_test_id, body.provider, True, job['id'])
            reference, outcome = result['provider_reference'], 'received'
        except (persona.IntegrationUnavailable, persona.InvalidProviderResult):
            # A timeout can follow a billable provider acceptance. Never retry blindly.
            pass
        applied = persona.database_rpc('finish_lockd_credit_request', {'p_id': job['id'], 'p_reference': reference, 'p_outcome': outcome})
        return {'state': outcome if applied else 'not_applied', 'environment': 'sandbox', 'booking_authorized': False}
    except persona.IntegrationUnavailable:
        return JSONResponse({'detail': 'Credit request unavailable'}, status_code=503)
