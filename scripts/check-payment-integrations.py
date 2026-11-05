"""Read-only payment boundary checks; no provider fixtures or business records."""
import ast
import asyncio
import os
from pathlib import Path
import sys
import secrets
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'services/intelligence'))
import httpx
import app
import daraja
import paystack
from persona import IntegrationUnavailable

for name in ('daraja', 'paystack', 'payments'):
    ast.parse((root / 'services/intelligence' / (name + '.py')).read_text(encoding='utf-8'))
print('PASS payment adapters parse')

with patch.dict(os.environ, {}, clear=True):
    for adapter in (daraja, paystack):
        assert adapter.configured() is False
        try:
            adapter.check_connection()
        except IntegrationUnavailable:
            continue
        raise AssertionError('Unconfigured provider accepted')
print('PASS absent credentials refuse authorization before network access')

module = ast.parse((root / 'services/intelligence/paystack.py').read_text(encoding='utf-8'))
tree = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'check_connection')
literals = [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)]
assert paystack.ORIGIN == 'https://api.paystack.co'
assert '/integration/payment_session_timeout' in literals
assert 'GET' in literals
assert not any(method in literals for method in ('POST', 'PUT', 'PATCH', 'DELETE'))
assert 'test' in literals
print('PASS Paystack uses its fixed read-only endpoint and requires a test key')

async def check_routes():
    # No lifespan: these requests intentionally cannot contact providers.
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='https://lockd.local') as client:
        response = await client.get('/health')
        assert response.status_code == 200
        for provider in ('daraja', 'paystack'):
            route = '/v1/integrations/' + provider + '/check'
            response = await client.post(route)
            assert response.status_code == 503
            assert response.headers['cache-control'] == 'no-store'
        for route in ('/webhooks/paystack', '/v1/jobs/paystack/reconcile', '/v1/documents/unlock'):
            response = await client.post(route, content=b'')
            assert response.status_code == 503
        app.app.state.paystack_authorization_verified = True
        try:
            app.check_payment_connection(app.app, 'paystack', paystack)
        except IntegrationUnavailable:
            pass
        else:
            raise AssertionError('Absent provider credentials accepted')
        assert app.app.state.paystack_authorization_verified is False

with patch.dict(os.environ, {}, clear=True):
    asyncio.run(check_routes())
print('PASS actual ASGI routes reject missing service configuration and clear stale success')

async def credential_boundaries(secret):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='https://lockd.local') as client:
        for route in ('/v1/jobs/paystack/reconcile','/v1/documents/unlock'):
            denied=await client.post(route, content=b'')
            assert denied.status_code == 401
        # A real ephemeral service token exercises validation; no database/provider call.
        invalid=await client.post('/v1/documents/unlock',json={'password': {'invalid': True}},headers={'Authorization': 'Bearer '+secret})
        assert invalid.status_code == 422 and invalid.json() == {'detail':'Invalid request details'}
        large=await client.post('/v1/documents/unlock',content=b' ' * 8193,headers={'Authorization': 'Bearer '+secret})
        assert large.status_code == 413
secret=secrets.token_urlsafe(48)
with patch.dict(os.environ, {'INTELLIGENCE_SHARED_SECRET':secret}, clear=True):
    asyncio.run(credential_boundaries(secret))
secret=None
print('PASS private routes deny unsigned calls, bound input size and redact validation input')
with patch.dict(os.environ, {}, clear=True):
    assert not paystack.verify_webhook(b'', '')
    assert not paystack.reconciliation_enabled()
    try:
        paystack.verify_transaction('')
    except IntegrationUnavailable:
        pass
    else:
        raise AssertionError('Disabled reconciliation accepted')
sql = (root / 'supabase/migrations/20261102_0024_lockd_test_payment_reconciliation.sql').read_text(encoding='utf-8')
assert sql.count('enable row level security') == 5
assert 'update public.lockd_bookings' not in sql.lower()
assert 'grant execute' in sql and 'to service_role' in sql
assert 'payload_sha256' in sql and 'for update skip locked' in sql
assert not any(token in sql.lower() for token in ('authorization_code', 'card_number', 'raw_payload'))
print('PASS sandbox ledger, durable leases and disabled webhook/verification boundaries')
print('6 read-only payment checks passed; no payment was created or provider response fabricated.')
