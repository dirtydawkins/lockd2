"""Hosted checkout for existing reservations; no client-supplied price or status.

Disabled until both the database and private environment enable it. Test
transactions remain in their own ledger and never confirm customer bookings.
"""
import hashlib
import hmac
import json
import os
import re

from persona import IntegrationUnavailable, InvalidProviderResult, database_rpc, request_json

REFERENCE = re.compile(r'lockd_pay_(test|live)_[a-f0-9]{32}')
URL = re.compile(r'https://checkout\.paystack\.com/[A-Za-z0-9_-]+')
STATUSES = frozenset(('abandoned', 'failed', 'ongoing', 'pending', 'processing', 'queued', 'reversed', 'success'))


def environment():
    value = os.getenv('PAYSTACK_ENVIRONMENT')
    return value if value in ('test', 'live') else None


def configured():
    env = environment()
    return (os.getenv('LOCKD_CHECKOUT_ENABLED') == 'true' and env is not None
            and re.fullmatch(r'sk_' + env + r'_[A-Za-z0-9]{1,256}', os.getenv('PAYSTACK_SECRET_KEY', '')) is not None)


def call(method, path, body=None):
    if not configured():
        raise IntegrationUnavailable()
    result, _ = request_json(method, 'https://api.paystack.co' + path,
                             {'Authorization': 'Bearer ' + os.environ['PAYSTACK_SECRET_KEY'],
                              'Content-Type': 'application/json', 'Accept': 'application/json'}, body)
    if not isinstance(result, dict) or result.get('status') is not True:
        raise InvalidProviderResult()
    return result.get('data')


def start(booking_id, customer_id, email, key):
    if not configured():
        raise IntegrationUnavailable()
    attempt = database_rpc('begin_lockd_checkout', {'p_booking_id': booking_id, 'p_customer_id': customer_id,
                           'p_key': key, 'p_environment': environment()})
    if attempt.get('initialize') is not True:
        url = attempt.get('url')
        return {'state': attempt['state'], 'url': url if isinstance(url, str) and URL.fullmatch(url) else None}
    # The reference and amount were committed first. An ambiguous timeout is
    # reconciled by reference, never retried as a new initialization/charge.
    result = call('POST', '/transaction/initialize', {'email': email,
                  'amount': str(attempt['amountMinor']), 'currency': attempt['currency'],
                  'reference': attempt['reference'],
                  'callback_url': 'https://lockd2.vercel.app/checkout.html?booking=' + booking_id})
    if (not isinstance(result, dict) or result.get('reference') != attempt['reference']
            or not isinstance(result.get('authorization_url'), str) or not URL.fullmatch(result['authorization_url'])):
        raise InvalidProviderResult()
    database_rpc('save_lockd_checkout_url', {'p_reference': attempt['reference'], 'p_url': result['authorization_url']})
    return {'state': 'pending', 'url': result['authorization_url']}


def verify(reference, customer_id=None):
    if not configured() or not isinstance(reference, str) or not REFERENCE.fullmatch(reference):
        raise IntegrationUnavailable()
    job = database_rpc('claim_lockd_checkout_check', {'p_reference': reference, 'p_customer_id': customer_id})
    if job is None:
        return {'state': 'unchanged'}
    return verify_job(job)


def verify_job(job):
    if job['environment'] != environment():
        raise IntegrationUnavailable()
    result = call('GET', '/transaction/verify/' + job['reference'])
    try:
        if (result['reference'] != job['reference'] or result['domain'] != environment()
                or type(result['id']) is not int or not 0 < result['id'] < 9223372036854775807
                or type(result['amount']) is not int or not 0 < result['amount'] <= 99999999999999
                or result['currency'] != 'KES' or result['status'] not in STATUSES):
            raise InvalidProviderResult()
        return database_rpc('finish_lockd_checkout', {'p_reference': job['reference'], 'p_provider_id': str(result['id']),
                            'p_amount_minor': result['amount'], 'p_currency': result['currency'],
                            'p_environment': result['domain'], 'p_status': result['status']})
    except (KeyError, TypeError, ValueError):
        raise InvalidProviderResult() from None


def reconcile_one():
    if not configured():
        raise IntegrationUnavailable()
    job = database_rpc('claim_lockd_checkout_check', {})
    return verify_job(job) if job else {'state': 'idle'}


def receive(raw, signature):
    if not configured():
        raise IntegrationUnavailable()
    if not isinstance(signature, str) or not re.fullmatch(r'[a-fA-F0-9]{128}', signature):
        raise InvalidProviderResult()
    expected = hmac.new(os.environ['PAYSTACK_SECRET_KEY'].encode(), raw, hashlib.sha512).hexdigest()
    if not hmac.compare_digest(expected, signature.lower()):
        raise InvalidProviderResult()
    try:
        event = json.loads(raw)
        reference = event.get('data', {}).get('reference')
        if isinstance(reference, str) and REFERENCE.fullmatch(reference):
            database_rpc('wake_lockd_checkout_check', {'p_reference': reference})
        return {'received': True}
    except (ValueError, TypeError, AttributeError):
        raise InvalidProviderResult() from None
