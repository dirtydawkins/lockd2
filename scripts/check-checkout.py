"""Run real rejection paths only. No accounts, bookings or payment fixtures."""
import asyncio
import os
from pathlib import Path
import sys
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'services/intelligence'))
import httpx
import app
import checkout
from persona import IntegrationUnavailable

async def check():
    with patch.dict(os.environ, {}, clear=True):
        assert checkout.configured() is False
        try:
            checkout.reconcile_one()
            raise AssertionError('Disabled checkout accepted')
        except IntegrationUnavailable:
            pass
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app.app), base_url='http://localhost') as client:
            for route in ('start','verify'):
                response = await client.post('/v1/checkout/'+route, json={})
                assert response.status_code == 503
            response = await client.post('/webhooks/checkout/paystack', content=b'')
            assert response.status_code == 503
    print('PASS checkout and webhook refuse missing configuration; no network or charge initiated')
    sql=(root/'supabase/migrations/20261105_0028_lockd_checkout.sql').read_text()
    for value in ('customer_id=auth.uid()',"if a.environment='live'",'not public.lockd_trust_ready(b)',
                  'x.id<>b.id','for update','enable row level security','amount_minor=rental_minor+deposit_minor',
                  "'review_required'",'lockd_checkout_journal_immutable'):
        assert value in sql, value
    assert "enabled boolean not null default false" in sql
    assert 'to authenticated' in sql and 'to service_role' in sql
    print('PASS migration boundaries: caller-owned reads, separate deposit, locked capacity and live-only confirmation')

asyncio.run(check())
