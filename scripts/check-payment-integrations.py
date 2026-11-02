"""Read-only payment boundary checks; no provider fixtures or business records."""
import ast
import asyncio
import os
from pathlib import Path
import sys
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'services/intelligence'))
import httpx
import app
import daraja
import paystack
from persona import IntegrationUnavailable

for name in ('daraja', 'paystack'):
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

tree = ast.parse((root / 'services/intelligence/paystack.py').read_text(encoding='utf-8'))
literals = [node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)]
assert 'https://api.paystack.co' in literals
assert '/integration/payment_session_timeout' in literals
assert 'GET' in literals
assert not any(method in literals for method in ('POST', 'PUT', 'PATCH', 'DELETE'))
assert 'test' in literals and any('sk_test_' in value for value in literals)
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
print('4 read-only payment checks passed; actual provider authorization still requires configured accounts.')
