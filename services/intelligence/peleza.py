"""Official Peleza client-credentials / individual CIR contract; SANDBOX ONLY.

Contract sources: docs.peleza.com/docs/api/authorization/ and
docs.peleza.com/docs/api/credit-reports/ (inspected 2026-11-02).
No live national IDs, automatic retries, production host or account creation.
"""
import os
import re
from uuid import UUID

from persona import request_json, IntegrationUnavailable, InvalidProviderResult

ORIGIN = 'https://sandbox.peleza.com'


def configured():
    return (os.getenv('PELEZA_ENABLED') == 'true'
            and os.getenv('PELEZA_ENVIRONMENT') == 'sandbox'
            and os.getenv('PELEZA_PURPOSE_APPROVED') == 'true'
            and bool(os.getenv('PELEZA_CLIENT_ID')) and bool(os.getenv('PELEZA_CLIENT_SECRET')))


def individual(approved_test_id, provider, consent, request_id):
    if not configured():
        raise IntegrationUnavailable()
    allowed = set(os.getenv('PELEZA_APPROVED_SANDBOX_IDS', '').split(','))
    if consent is not True or provider not in ('creditinfo', 'metropol'):
        raise ValueError('Explicit credit consent and supported provider required')
    if not re.fullmatch(r'\d{6,10}', approved_test_id or '') or approved_test_id not in allowed:
        raise ValueError('Only provider-approved sandbox identities are permitted')
    request_id = str(UUID(request_id))
    auth, _ = request_json('POST', ORIGIN + '/api/v1/oauth/token', {'Content-Type': 'application/json'},
                           {'grant_type': 'client_credentials', 'client_id': os.getenv('PELEZA_CLIENT_ID'),
                            'client_secret': os.getenv('PELEZA_CLIENT_SECRET')})
    if not isinstance(auth, dict) or not isinstance(auth.get('data'), dict):
        raise InvalidProviderResult()
    token = auth['data'].get('access_token') if auth.get('success') is True else None
    if not isinstance(token, str) or not 16 <= len(token) <= 8192:
        raise InvalidProviderResult()
    result, _ = request_json('POST', ORIGIN + '/api/v1/credit-info/individual/ke',
                            {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
                            {'id_number': approved_test_id, 'provider': provider, 'consent': True,
                             'customer_number': request_id})
    if not isinstance(result, dict):
        raise InvalidProviderResult()
    data = result.get('data')
    if result.get('success') is not True or result.get('response_code') != 200 or not isinstance(data, dict) or data.get('provider') != provider:
        raise InvalidProviderResult()
    # Minimize retained results: no household, employment, demographics or raw report.
    reference = result.get('request_id')
    try:
        reference = str(UUID(reference))
    except (ValueError, TypeError, AttributeError):
        raise InvalidProviderResult() from None
    return {'environment': 'sandbox', 'provider': provider, 'provider_reference': reference,
            'status': 'report_received', 'review_required': True, 'booking_authorized': False,
            'score': None, 'raw_report_retained': False}
