"""Internal, deterministic decision support. No trained model or credit lookup."""
import hmac
import json
import logging
import os
import time
from collections import deque
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

app = FastAPI(title="LOCKD intelligence", docs_url=None, redoc_url=None, openapi_url=None)
logger = logging.getLogger("lockd.intelligence")
VERSION = "rules-1"
requests_in_window = deque(maxlen=120)

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
            if size > 8192:
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
    if not length.isdecimal() or int(length) > 8192:
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
    return {"status": "ok", "rules_version": VERSION, "trained_model": False}

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
