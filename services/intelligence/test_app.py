import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import app, secret_for_window, authorize
from fastapi import HTTPException

class IntelligenceTests(unittest.TestCase):
    def setUp(self):
        os.environ["INTELLIGENCE_SHARED_SECRET"] = "test-only-" + "x" * 40
        secret_for_window.cache_clear()
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer " + os.environ["INTELLIGENCE_SHARED_SECRET"]}

    def test_health_and_configuration(self):
        self.assertFalse(self.client.get("/health").json()["trained_model"])
        self.assertEqual(self.client.get("/ready").status_code, 200)
        os.environ["INTELLIGENCE_SHARED_SECRET"] = ""
        secret_for_window.cache_clear()
        self.assertEqual(self.client.get("/ready").status_code, 503)

    def test_unauthorized_and_missing_data(self):
        self.assertEqual(self.client.post("/v1/risk/assess", json={}).status_code, 401)
        r = self.client.post("/v1/risk/assess", headers=self.auth, json={})
        self.assertEqual(r.json()["decision"], "insufficient_data")
        self.assertIn("x-request-id", r.headers)

    def test_manual_review_and_unknown_fields(self):
        r = self.client.post("/v1/risk/assess", headers=self.auth, json={"confirmed_unresolved_incident": True})
        self.assertEqual(r.json()["decision"], "manual_review")
        self.assertEqual(self.client.post("/v1/risk/assess", headers=self.auth, json={"credit_score": 600}).status_code, 422)

    def test_eligibility_does_not_invent_credit_or_authorization(self):
        r = self.client.post("/v1/rentals/eligibility", headers=self.auth, json={"identity_required_by_policy": True})
        self.assertEqual(r.json()["requirements"], ["identity_verification"])
        self.assertFalse(r.json()["credit_check_performed"])
        self.assertFalse(r.json()["booking_authorized"])

    def test_lambda_authentication_uses_aws_identity_not_browser_headers(self):
        allowed = "arn:aws:sts::123456789012:assumed-role/lockd-backend/"
        with patch.dict(os.environ, {"AWS_LAMBDA_FUNCTION_NAME": "test", "INTELLIGENCE_CALLER_ARN": allowed}):
            with self.assertRaises(HTTPException):
                authorize(SimpleNamespace(scope={}), self.auth["Authorization"])
            request = SimpleNamespace(scope={"aws.event": {"requestContext": {"authorizer": {"iam": {"userArn": allowed + "test-session"}}}}})
            self.assertIsNone(authorize(request, None))

if __name__ == "__main__":
    unittest.main()
