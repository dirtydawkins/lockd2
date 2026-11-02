"""Private Paystack test authorization using a read-only integration endpoint."""
import os
import re

from persona import IntegrationUnavailable, InvalidProviderResult, request_json

ORIGIN = 'https://api.paystack.co'


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
