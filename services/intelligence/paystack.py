"""Private Paystack test authorization using a read-only integration endpoint."""
import os
import re
import hashlib
import hmac
import json

from persona import IntegrationUnavailable, InvalidProviderResult, request_json

ORIGIN = 'https://api.paystack.co'
REFERENCE = re.compile(r'lockd_test_[a-f0-9]{32}')
STATUSES = frozenset(('abandoned', 'failed', 'ongoing', 'pending', 'processing', 'queued', 'reversed', 'success'))


def configured():
    key = os.getenv('PAYSTACK_SECRET_KEY', '')
    return (os.getenv('PAYSTACK_ENVIRONMENT') == 'test'
            and re.fullmatch(r'sk_test_[A-Za-z0-9]{1,256}', key) is not None)


def check_connection():
    if not configured():
        raise IntegrationUnavailable()
    body, _ = request_json('GET', ORIGIN + '/integration/payment_session_timeout',
                           {'Authorization': 'Bearer ' + os.environ['PAYSTACK_SECRET_KEY'],
                            'Accept': 'application/json'})
    if not isinstance(body, dict) or body.get('status') is not True:
        raise InvalidProviderResult()
    data = body.get('data')
    timeout = data.get('payment_session_timeout') if isinstance(data, dict) else None
    if type(timeout) is not int or timeout < 0:
        raise InvalidProviderResult()
    return {'environment': 'test', 'authorization_verified': True,
            'payment_processed': False, 'booking_authorized': False}


def reconciliation_enabled():
    return configured() and os.getenv('PAYSTACK_TEST_RECONCILIATION_ENABLED') == 'true'


def verify_webhook(raw, signature):
    """Authenticate the exact bytes before parsing. No provider body is retained."""
    if (not configured() or not isinstance(raw, bytes) or len(raw) > 262144
            or not isinstance(signature, str) or re.fullmatch(r'[a-fA-F0-9]{128}', signature) is None):
        return False
    digest = hmac.new(os.environ['PAYSTACK_SECRET_KEY'].encode(), raw, hashlib.sha512).hexdigest()
    return hmac.compare_digest(digest, signature.lower())


def webhook_reference(raw):
    """Only known LOCKD test references are eligible for a durable verification job."""
    try:
        event = json.loads(raw)
        if not isinstance(event, dict):
            raise InvalidProviderResult()
        if event.get('event') != 'charge.success':
            return None
        data = event['data']
        if not isinstance(data, dict) or data.get('domain') != 'test':
            raise InvalidProviderResult()
        reference = data.get('reference')
        if not isinstance(reference, str) or REFERENCE.fullmatch(reference) is None:
            return None
        return reference
    except (KeyError, TypeError, ValueError):
        raise InvalidProviderResult() from None


def verify_transaction(reference):
    """A signed event or browser callback alone is never proof of payment.

    Fetch the current transaction from Paystack, refuse live responses and return
    only the fields needed to reconcile a previously registered database intent.
    Payment instruments, reusable charge authorizations and personal data are
    deliberately discarded.
    """
    if not reconciliation_enabled():
        raise IntegrationUnavailable()
    if not isinstance(reference, str) or REFERENCE.fullmatch(reference) is None:
        raise InvalidProviderResult()
    body, _ = request_json('GET', ORIGIN + '/transaction/verify/' + reference,
                           {'Authorization': 'Bearer ' + os.environ['PAYSTACK_SECRET_KEY'],
                            'Accept': 'application/json'})
    try:
        if not isinstance(body, dict) or body.get('status') is not True:
            raise InvalidProviderResult()
        data = body['data']
        transaction_id, amount, currency, status = data['id'], data['amount'], data['currency'], data['status']
        if (data['domain'] != 'test' or data['reference'] != reference
                or type(transaction_id) is not int or not 0 < transaction_id < 9223372036854775807
                or type(amount) is not int or not 0 < amount <= 99999999999999
                or currency != 'KES' or status not in STATUSES):
            raise InvalidProviderResult()
        return {'reference': reference, 'provider_id': str(transaction_id),
                'amount_minor': amount, 'currency': currency, 'status': status, 'environment': 'test'}
    except (KeyError, TypeError, ValueError):
        raise InvalidProviderResult() from None
