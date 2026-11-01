"""Private Daraja sandbox authorization. No STK push, payout or live-payment route.

Consumer credentials stay in the existing Render service environment. Successful
OAuth authorization is NOT evidence that a customer paid or a booking is confirmed.
"""
import base64
import json
import os
from urllib.request import Request, build_opener

from persona import IntegrationUnavailable, InvalidProviderResult, NoRedirect

ORIGIN = 'https://sandbox.safaricom.co.ke'


def configured():
    return (os.getenv('DARAJA_ENVIRONMENT') == 'sandbox'
            and bool(os.getenv('DARAJA_CONSUMER_KEY'))
            and bool(os.getenv('DARAJA_CONSUMER_SECRET')))


def check_connection():
    if not configured():
        raise IntegrationUnavailable()
    credentials = (os.environ['DARAJA_CONSUMER_KEY'] + ':' + os.environ['DARAJA_CONSUMER_SECRET']).encode()
    header = 'Basic ' + base64.b64encode(credentials).decode('ascii')
    try:
        request = Request(ORIGIN + '/oauth/v1/generate?grant_type=client_credentials',
                          headers={'Authorization': header, 'Accept': 'application/json'})
        with build_opener(NoRedirect).open(request, timeout=5) as response:
            raw = response.read(16385)
        if len(raw) > 16384:
            raise InvalidProviderResult()
        body = json.loads(raw)
        token, expires = body.get('access_token'), str(body.get('expires_in', ''))
        if not isinstance(token, str) or not 16 <= len(token) <= 8192 or not expires.isdecimal() or not 1 <= int(expires) <= 86400:
            raise InvalidProviderResult()
        # No token, raw provider response or secrets cross this diagnostic boundary.
        return {'environment': 'sandbox', 'authorization_verified': True,
                'payment_processed': False, 'booking_authorized': False}
    except (OSError, ValueError, TypeError, AttributeError):
        raise IntegrationUnavailable() from None
