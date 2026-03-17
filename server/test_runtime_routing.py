import base64
import os
import sys
import unittest

from fastapi.testclient import TestClient

SERVER_DIR = os.path.dirname(__file__)
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import app as server_app


class RuntimeRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(server_app.app)
        cls.audio_payload = {"audio_base64": base64.b64encode(b"pcm").decode("utf-8")}

    def test_health_contains_routing_status(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        runtime = resp.json().get("runtime", {})
        self.assertIn("active_profile", runtime)
        self.assertIn("legacy_head_loaded", runtime)

    def test_legacy_classify_endpoint_hidden(self):
        resp = self.client.post("/classify/legacy", json=self.audio_payload)
        self.assertEqual(resp.status_code, 404)

    def test_active_classify_endpoint_exists(self):
        resp = self.client.post("/classify/active", json=self.audio_payload)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn("detected", body)
        self.assertEqual(body.get("model_profile"), "active")

    def test_runtime_switch_endpoint(self):
        switch_resp = self.client.post("/runtime/classifier/switch", json={"profile": "legacy"})
        self.assertEqual(switch_resp.status_code, 403)

        reset_resp = self.client.post("/runtime/classifier/switch", json={"profile": "active"})
        self.assertEqual(reset_resp.status_code, 200)
        self.assertEqual(reset_resp.json().get("active_profile"), "active")

    def test_archive_endpoint_exists(self):
        resp = self.client.post("/runtime/legacy/archive", json={"overwrite": True})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn("ok", body)
        self.assertIn("legacy_model_path", body)


if __name__ == "__main__":
    unittest.main()
