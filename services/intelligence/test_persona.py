import hashlib
import hmac
import json
import os
import time
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import app, requests_in_window
import persona

ATTEMPT = '22222222-2222-4222-8222-222222222222'
SECRET = 'synthetic-webhook-secret-' + 'x' * 32


def fixture_event():
    return json.dumps({'data': {'id': 'evt_test', 'type': 'event', 'attributes': {
        'name': 'inquiry.approved', 'created-at': '2026-10-31T18:35:00Z',
        'payload': {'data': {'id': 'inq_test', 'type': 'inquiry', 'attributes': {
            'status': 'approved', 'fields': {'private': 'DO-NOT-RETAIN'}}}}}}}).encode()


def signed(raw, timestamp=None, secret=SECRET):
    stamp = str(int(time.time()) if timestamp is None else timestamp)
    return f't={stamp},v1=' + hmac.new(secret.encode(), stamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()


class PersonaTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'PERSONA_ENABLED': 'true', 'PERSONA_ENVIRONMENT': 'sandbox',
          'PERSONA_API_KEY': 'synthetic-key', 'PERSONA_ENVIRONMENT_ID': 'env_sandbox',
          'PERSONA_TEMPLATE_ID': 'itmpl_test', 'PERSONA_WEBHOOK_SECRET': SECRET,
          'PERSONA_PASSPORT_VALID_DAYS': '30', 'INTELLIGENCE_SHARED_SECRET': 'test-' + 'a' * 40})
        self.env.start(); self.addCleanup(self.env.stop)
        requests_in_window.clear()

    def test_signature_uses_raw_body_fresh_timestamp_and_every_rotation_set(self):
        raw = fixture_event()
        self.assertTrue(persona.verify_signature(raw, signed(raw), [SECRET]))
        self.assertFalse(persona.verify_signature(raw + b' ', signed(raw), [SECRET]))
        self.assertFalse(persona.verify_signature(raw, signed(raw, int(time.time()) - 301), [SECRET]))
        self.assertFalse(persona.verify_signature(raw, signed(raw, int(time.time()) + 301), [SECRET]))
        self.assertFalse(persona.verify_signature(raw, 'not-a-signature', [SECRET]))
        header = signed(raw, secret='old-' + SECRET) + ' ' + signed(raw)
        self.assertTrue(persona.verify_signature(raw, header, [SECRET]))

    def test_event_metadata_discards_documents_fields_and_status_claims(self):
        metadata = persona.event_metadata(fixture_event())
        self.assertEqual(set(metadata), {'p_event_id', 'p_inquiry_id', 'p_created_at', 'p_environment', 'p_sha256'})
        self.assertNotIn('DO-NOT-RETAIN', json.dumps(metadata))
        self.assertNotIn('approved', json.dumps(metadata))
        with self.assertRaises(persona.InvalidProviderResult):
            persona.event_metadata(b'{}')

    def test_disabled_configuration_and_production_never_call_provider(self):
        provider = persona.Persona(lambda *args: self.fail('Must not call provider'))
        for value in ['production', '', 'test']:
            os.environ['PERSONA_ENVIRONMENT'] = value
            with self.assertRaises(persona.IntegrationUnavailable):
                provider.create(ATTEMPT)
        os.environ['PERSONA_ENVIRONMENT'] = 'sandbox'
        os.environ['PERSONA_ENABLED'] = 'false'
        with self.assertRaises(persona.IntegrationUnavailable):
            provider.retrieve('inq_test')

    def test_provider_contract_has_fixed_origin_version_opaque_reference_and_idempotency(self):
        seen = []
        def transport(*args):
            seen.append(args)
            return {'data': {'id': 'inq_test','attributes':{'reference-id':ATTEMPT,'status':'created','fields':{'private':'DO-NOT-RETAIN'}}}}, {'Persona-Environment-Id': 'env_sandbox'}
        result=persona.Persona(transport).create(ATTEMPT)
        self.assertNotIn('DO-NOT-RETAIN',json.dumps(result))
        method, url, headers, body = seen[0]
        self.assertEqual(url, 'https://api.withpersona.com/api/v1/inquiries')
        self.assertEqual(headers['Persona-Version'], '2026-09-29')
        self.assertEqual(headers['Idempotency-Key'], ATTEMPT)
        self.assertEqual(body['data']['attributes'], {'inquiry-template-id': 'itmpl_test', 'reference-id': ATTEMPT})
        with self.assertRaises(persona.InvalidProviderResult):
            persona.Persona(transport).retrieve('../inquiries')
        with self.assertRaises(persona.InvalidProviderResult):
            persona.Persona(lambda *args: ({}, {'Persona-Environment-Id': 'env_production'})).create(ATTEMPT)

    def test_webhook_acknowledges_only_after_durable_receipt_and_does_not_trust_status(self):
        client = TestClient(app); raw = fixture_event(); seen = []
        with patch.object(persona, 'database_rpc', side_effect=lambda name, args: seen.append((name, args))):
            response = client.post('/webhooks/persona', content=raw, headers={'Persona-Signature': signed(raw)})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(seen[0][0], 'enqueue_lockd_identity_event')
        self.assertNotIn('status', json.dumps(seen))
        with patch.object(persona, 'database_rpc', side_effect=persona.IntegrationUnavailable):
            self.assertEqual(client.post('/webhooks/persona', content=raw, headers={'Persona-Signature': signed(raw)}).status_code, 503)
        self.assertEqual(client.post('/webhooks/persona', content=raw).status_code, 401)

    def test_worker_retrieves_authoritative_results_and_never_confirms_booking(self):
        job = {'eventId': 'evt_test', 'leaseToken': ATTEMPT, 'attemptId': ATTEMPT, 'environment': 'sandbox', 'inquiryId': 'inq_test'}
        calls = []
        def rpc(name, args):
            calls.append((name, args))
            return job if name == 'claim_lockd_identity_job' else None
        class Provider:
            def retrieve(self, inquiry):
                return {'inquiry_id': inquiry, 'reference_id': ATTEMPT, 'status': 'needs_review', 'updated_at': '2026-10-31T20:00:00Z'}
        result = persona.reconcile_one(Provider(), rpc)
        self.assertFalse(result['booking_authorized'])
        self.assertEqual(calls[-1][0], 'finish_lockd_identity_job')
        self.assertEqual(calls[-1][1]['p_status'], 'needs_review')

    def test_provider_failure_is_a_durable_retry_not_a_verification(self):
        job = {'eventId': 'evt_test', 'leaseToken': ATTEMPT, 'attemptId': ATTEMPT, 'environment': 'sandbox', 'inquiryId': 'inq_test'}
        calls = []
        def rpc(name, args):
            calls.append((name, args)); return job if name == 'claim_lockd_identity_job' else None
        class Provider:
            def retrieve(self, inquiry):
                raise persona.IntegrationUnavailable()
        self.assertEqual(persona.reconcile_one(Provider(), rpc)['state'], 'retry_scheduled')
        self.assertEqual(calls[-1][0], 'retry_lockd_identity_job')
        self.assertNotIn('finish_lockd_identity_job', [c[0] for c in calls])

    def test_worker_route_requires_internal_auth_and_webhook_body_is_bounded(self):
        client = TestClient(app)
        self.assertEqual(client.post('/v1/jobs/persona/reconcile').status_code, 401)
        self.assertEqual(client.post('/webhooks/persona', content=b'x' * 262145).status_code, 413)


if __name__ == '__main__':
    unittest.main()
