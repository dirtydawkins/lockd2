import os
import unittest
from fastapi.testclient import TestClient
from app import app, requests_in_window, authorize
from fastapi import HTTPException

class IntelligenceTests(unittest.TestCase):
    def setUp(self):
        os.environ["INTELLIGENCE_SHARED_SECRET"] = "test-only-" + "x" * 40
        requests_in_window.clear()
        self.client = TestClient(app)
        self.auth = {"Authorization": "Bearer " + os.environ["INTELLIGENCE_SHARED_SECRET"]}

    def test_health_and_configuration(self):
        self.assertFalse(self.client.get("/health").json()["trained_model"])
        self.assertEqual(self.client.get("/ready").status_code, 200)
        os.environ["INTELLIGENCE_SHARED_SECRET"] = ""
        self.assertEqual(self.client.get("/ready").status_code, 503)

    def test_unauthorized_and_missing_data(self):
        self.assertEqual(self.client.post("/v1/risk/assess", json={}).status_code, 401)
        self.assertEqual(self.client.get("/v1/risk/assess").status_code, 401)
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

    def test_invalid_credentials_fail_without_an_alternate_authentication_path(self):
        for authorization in (None, "Bearer wrong", "Bearer non-ascii-\u2603"):
            with self.assertRaises(HTTPException) as caught:
                authorize(authorization)
            self.assertEqual(caught.exception.status_code, 401)

    def test_oversized_and_streamed_requests_are_bounded(self):
        self.assertEqual(self.client.post("/v1/risk/assess", headers=self.auth, content=b"x" * 9000).status_code, 413)
        stream = iter([b"x" * 4000, b"x" * 4000, b"x" * 4000])
        self.assertEqual(self.client.post("/v1/risk/assess", headers=self.auth, content=stream).status_code, 413)

    def test_abuse_limit_returns_retry_state(self):
        for _ in range(120):
            self.client.post("/v1/risk/assess", headers=self.auth, json={})
        response = self.client.post("/v1/risk/assess", headers=self.auth, json={})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["Retry-After"], "60")

    def test_logs_exclude_authorization_and_request_facts(self):
        with self.assertLogs("lockd.intelligence", level="INFO") as captured:
            self.client.post("/v1/risk/assess", headers=self.auth, json={})
        self.assertNotIn(os.environ["INTELLIGENCE_SHARED_SECRET"], "".join(captured.output))
        self.assertNotIn("confirmed_unresolved_incident", "".join(captured.output))

if __name__ == "__main__":
    unittest.main()
