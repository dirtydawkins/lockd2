"""Durable leased processing; no in-memory queue and no automatic approvals."""
import json
import os
import re
import subprocess
import sys
import tempfile
from urllib.request import Request, build_opener
from urllib.parse import quote

from persona import database_rpc, IntegrationUnavailable, NoRedirect
from .address import compare
from .safety import MAX_BYTES, UnsafeDocument, ScannerUnavailable, identify, scan


def configured():
    return os.getenv("DOCUMENT_PROCESSING_ENABLED") == "true" and bool(os.getenv("DOCUMENT_CLAMD_SOCKET"))


def storage(method, path):
    origin = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", origin) or len(key) < 32 or not re.fullmatch(r"[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}", path):
        raise IntegrationUnavailable()
    url = origin + "/storage/v1/object/lockd-verification-private" + ("/" + quote(path, safe="/") if method == "GET" else "")
    body = None if method == "GET" else json.dumps({"prefixes": [path]}).encode()
    try:
        with build_opener(NoRedirect).open(Request(url, data=body, method=method, headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}), timeout=5) as response:
            data = response.read(MAX_BYTES + 1 if method == "GET" else 8192)
            if len(data) > MAX_BYTES:
                raise UnsafeDocument("file_size")
            return data
    except UnsafeDocument:
        raise
    except OSError:
        raise IntegrationUnavailable() from None


def isolated(data):
    # A hard wall timeout and OS process exit protect the web process from parser hangs.
    # Linux child additionally applies CPU, address-space and output-file limits.
    with tempfile.TemporaryFile() as output:
        result = subprocess.run([sys.executable, "-m", "documents.worker"], input=data, stdout=output,
                                stderr=subprocess.DEVNULL, timeout=25, cwd=os.path.dirname(os.path.dirname(__file__)))
        output.seek(0)
        raw = output.read(262145)
        if len(raw) > 262144:
            raise UnsafeDocument("analysis_complexity")
    try:
        item = json.loads(raw)
        if result.returncode == 2:
            raise UnsafeDocument("unsafe_file")
        if result.returncode or item.get("version") != "documents-rules-1":
            raise IntegrationUnavailable()
        return item
    except (ValueError, TypeError):
        raise IntegrationUnavailable() from None


def process_one(rpc=database_rpc, downloader=storage, scanner=scan, analyzer=isolated):
    if not configured():
        raise IntegrationUnavailable()
    job = rpc("claim_lockd_document_job", {})
    if job is None:
        return {"state": "idle"}
    result, error = None, None
    try:
        raw = downloader("GET", job["path"])
        if len(raw) != job["byte_size"] or identify(raw) != job["mime"]:
            raise UnsafeDocument("file_mismatch")
        # Always before native image/PDF parsing. Never treat absent scan as clean.
        scanner(raw)
        result = analyzer(raw)
        result["address_match"] = compare(job["declared_address"], result.get("fields", {}).get("service_address", {}).get("value", ""))
    except ScannerUnavailable:
        error = "scanner_unavailable"
    except UnsafeDocument:
        error = "unsafe_file"
    except (IntegrationUnavailable, subprocess.TimeoutExpired, OSError):
        error = "analysis_unavailable"
    applied = rpc("finish_lockd_document_job", {"p_document_id": job["document_id"], "p_lease_token": job["lease_token"], "p_result": result, "p_error": error})
    return {"state": "screened" if applied and error is None else "not_applied" if not applied else "review_or_retry", "booking_authorized": False}


def delete_one(rpc=database_rpc, delete=storage):
    rpc('purge_lockd_expired_address_cases', {})
    job = rpc("claim_lockd_document_deletion", {})
    if job is None:
        return {"state": "idle"}
    delete("DELETE", job["path"])
    applied = rpc("finish_lockd_document_deletion", {"p_document_id": job["document_id"], "p_token": job["token"]})
    return {"state": "deleted" if applied else "not_applied"}
