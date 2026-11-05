"""Persona adapter, disabled by default. Official API contract 2026-09-29.

No identity documents, biometric data, provider bodies or credentials are logged.
No browser redirect can set verification or payment state.
"""
import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID


class IntegrationUnavailable(Exception):
    pass


class InvalidProviderResult(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(method, url, headers, body=None):
    """Fixed-origin callers only; bound time, body and redirects. Never echo errors."""
    data = None if body is None else json.dumps(body).encode()
    try:
        with build_opener(NoRedirect).open(Request(url, data=data, headers=headers, method=method), timeout=3) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise InvalidProviderResult()
            return json.loads(raw), dict(response.headers)
    except InvalidProviderResult:
        raise
    except HTTPError as error:
        unavailable = IntegrationUnavailable()
        # Status only, never a provider body, URL query, secret or personal data.
        unavailable.status_code = error.code
        raise unavailable from None
    except (OSError, ValueError):
        raise IntegrationUnavailable() from None


def enabled():
    return (os.getenv('PERSONA_ENABLED') == 'true'
            and os.getenv('PERSONA_ENVIRONMENT') == 'sandbox'
            and bool(os.getenv('PERSONA_API_KEY'))
            and bool(os.getenv('PERSONA_ENVIRONMENT_ID')))


def verify_signature(raw, header, secrets, now=None, tolerance=300):
    """Accept any valid rotation set, with a fresh signed delivery timestamp."""
    if not isinstance(raw, bytes) or not isinstance(header, str) or len(header) > 4096:
        return False
    now = time.time() if now is None else now
    for pair in header.split():
        match = re.fullmatch(r't=([0-9]{1,12}),v1=([a-fA-F0-9]{64})', pair)
        if not match:
            continue
        timestamp, signature = match.groups()
        if abs(now - int(timestamp)) > tolerance:
            continue
        message = timestamp.encode() + b'.' + raw
        for secret in secrets:
            if len(secret) >= 32 and hmac.compare_digest(hmac.new(secret.encode(), message, hashlib.sha256).hexdigest(), signature.lower()):
                return True
    return False


def event_metadata(raw):
    """Retain only opaque event/inquiry IDs, timestamp and digest; discard PII."""
    try:
        event = json.loads(raw)['data']
        attrs = event['attributes']
        inquiry = attrs['payload']['data']
        if event['type'] != 'event' or inquiry['type'] != 'inquiry':
            raise InvalidProviderResult()
        if not re.fullmatch(r'evt_[A-Za-z0-9]{1,100}', event['id']) or not re.fullmatch(r'inq_[A-Za-z0-9]{1,100}', inquiry['id']):
            raise InvalidProviderResult()
        if not attrs['name'].startswith('inquiry.'):
            raise InvalidProviderResult()
        created = datetime.fromisoformat(attrs['created-at'].replace('Z', '+00:00'))
        if created.tzinfo is None:
            raise InvalidProviderResult()
        return {'p_event_id': event['id'], 'p_inquiry_id': inquiry['id'], 'p_created_at': created.isoformat(),
                'p_environment': 'sandbox', 'p_sha256': hashlib.sha256(raw).hexdigest()}
    except (KeyError, TypeError, ValueError, AttributeError):
        raise InvalidProviderResult() from None


class Persona:
    def __init__(self, transport=request_json):
        self.transport = transport

    def _call(self, method, path, body=None, key=None):
        if not enabled():
            raise IntegrationUnavailable()
        headers = {'Authorization': 'Bearer ' + os.environ['PERSONA_API_KEY'], 'Persona-Version': '2026-09-29',
                   'Content-Type': 'application/json', 'Accept': 'application/json'}
        if key:
            headers['Idempotency-Key'] = key
        response, returned_headers = self.transport(method, 'https://api.withpersona.com/api/v1' + path, headers, body)
        environment = next((v for k, v in returned_headers.items() if k.lower() == 'persona-environment-id'), None)
        if environment != os.environ['PERSONA_ENVIRONMENT_ID']:
            raise InvalidProviderResult()
        return response

    @staticmethod
    def validate_inquiry_id(inquiry):
        if not isinstance(inquiry, str) or not re.fullmatch(r'inq_[A-Za-z0-9]{1,100}', inquiry):
            raise InvalidProviderResult()

    def create(self, attempt_id):
        attempt = str(UUID(attempt_id))
        template = os.getenv('PERSONA_TEMPLATE_ID', '')
        if not re.fullmatch(r'itmpl_[A-Za-z0-9]{1,100}', template):
            raise IntegrationUnavailable()
        response = self._call('POST', '/inquiries', {'data': {'attributes': {'inquiry-template-id': template, 'reference-id': attempt}}}, key=attempt)
        result = self.session_metadata(response)
        if result['reference_id'] != attempt:
            raise InvalidProviderResult()
        return result

    @staticmethod
    def session_metadata(response):
        try:
            data = response['data']; attrs = data['attributes']
            Persona.validate_inquiry_id(data['id'])
            # Session material is returned only to the trusted caller, never persisted/logged.
            return {'inquiry_id': data['id'], 'reference_id': str(UUID(attrs['reference-id'])),
                    'status': attrs['status'], 'session_token': response.get('meta', {}).get('session-token')}
        except (KeyError, TypeError, ValueError, AttributeError):
            raise InvalidProviderResult() from None

    def retrieve(self, inquiry):
        self.validate_inquiry_id(inquiry)
        query = urlencode({'fields[inquiry]': 'status,reference-id,updated-at,expires-at'})
        response = self._call('GET', f'/inquiries/{inquiry}?{query}')
        try:
            data = response['data']; attrs = data['attributes']
            if data['id'] != inquiry or data['type'] != 'inquiry':
                raise InvalidProviderResult()
            reference = str(UUID(attrs['reference-id']))
            updated = datetime.fromisoformat(attrs['updated-at'].replace('Z', '+00:00'))
            if updated.tzinfo is None:
                raise InvalidProviderResult()
            return {'inquiry_id': inquiry, 'reference_id': reference, 'status': attrs['status'], 'updated_at': updated.isoformat()}
        except (KeyError, TypeError, ValueError, AttributeError):
            raise InvalidProviderResult() from None

    def resume(self, inquiry):
        self.validate_inquiry_id(inquiry)
        result = self.session_metadata(self._call('POST', f'/inquiries/{inquiry}/resume'))
        if result['inquiry_id'] != inquiry:
            raise InvalidProviderResult()
        return result


def database_rpc(name, args, transport=request_json):
    origin = os.getenv('SUPABASE_URL', '')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', origin) or len(key) < 32:
        raise IntegrationUnavailable()
    result, _ = transport('POST', f'{origin}/rest/v1/rpc/{name}',
                          {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}, args)
    return result


def reconcile_one(provider=None, rpc=database_rpc):
    """One durable, leased job per call. No scheduler, free worker or success is invented."""
    if not enabled():
        raise IntegrationUnavailable()
    days = os.getenv('PERSONA_PASSPORT_VALID_DAYS', '')
    if not days.isdecimal() or not 1 <= int(days) <= 365:
        raise IntegrationUnavailable()
    job = rpc('claim_lockd_identity_job', {})
    if job is None:
        return {'state': 'idle'}
    if job['environment'] != 'sandbox':
        rpc('retry_lockd_identity_job', {'p_event_id': job['eventId'], 'p_lease_token': job['leaseToken'], 'p_error_code': 'ownership_mismatch'})
        return {'state': 'manual_review_required'}
    try:
        result = (provider or Persona()).retrieve(job['inquiryId'])
        if result['reference_id'] != job['attemptId']:
            raise InvalidProviderResult()
        rpc('finish_lockd_identity_job', {'p_event_id': job['eventId'], 'p_lease_token': job['leaseToken'],
             'p_inquiry_id': result['inquiry_id'], 'p_reference_id': result['reference_id'], 'p_status': result['status'],
             'p_provider_updated_at': result['updated_at'], 'p_valid_days': int(days)})
        return {'state': 'reconciled', 'environment': 'sandbox', 'booking_authorized': False}
    except (IntegrationUnavailable, InvalidProviderResult, KeyError):
        rpc('retry_lockd_identity_job', {'p_event_id': job['eventId'], 'p_lease_token': job['leaseToken'], 'p_error_code': 'provider_unavailable'})
        return {'state': 'retry_scheduled'}
