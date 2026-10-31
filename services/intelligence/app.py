"""Internal, deterministic decision support. No trained model or credit lookup."""
import hmac
import json
import logging
import os
import time
from functools import lru_cache
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(title="LOCKD intelligence", docs_url=None, redoc_url=None, openapi_url=None)
logger = logging.getLogger("lockd.intelligence")
VERSION = "rules-1"

@lru_cache(maxsize=1)
def secret_for_window(window: int) -> str:
    local = os.getenv("INTELLIGENCE_SHARED_SECRET", "")
    return local

def shared_secret() -> str:
    try:
        return secret_for_window(int(time.time() // 300))
    except Exception:
        return ""

def authorize(request: Request, authorization: Annotated[str | None, Header()] = None):
    if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
        # Mangum obtains this from the Lambda event, never an HTTP header.
        principal = request.scope.get("aws.event", {}).get("requestContext", {}).get("authorizer", {}).get("iam", {}).get("userArn", "")
        allowed = os.getenv("INTELLIGENCE_CALLER_ARN", "")
        if not allowed:
            raise HTTPException(503, "Service configuration unavailable")
        # A trailing slash permits sessions of one configured assumed role.
        valid = principal.startswith(allowed) if allowed.endswith("/") else hmac.compare_digest(principal, allowed)
        if not principal or not valid:
            raise HTTPException(401, "Service authentication required")
        return
    expected = shared_secret()
    if len(expected) < 32:
        raise HTTPException(503, "Service configuration unavailable")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {expected}"):
        raise HTTPException(401, "Service authentication required")

@app.middleware("http")
async def guard_and_log(request: Request, call_next):
    correlation = str(uuid4())
    length = request.headers.get("content-length", "0")
    if not length.isdecimal() or int(length) > 8192:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    if len(await request.body()) > 8192:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
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
    configured = bool(os.getenv("INTELLIGENCE_CALLER_ARN")) if os.getenv("AWS_LAMBDA_FUNCTION_NAME") else len(shared_secret()) >= 32
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
