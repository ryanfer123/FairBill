from fastapi.testclient import TestClient

from fairbill.hosted_app import app


def test_patient_portal_is_gated_and_rejects_unsafe_auth_configuration(monkeypatch):
    monkeypatch.setenv("FAIRBILL_PROFILE", "hosted")
    monkeypatch.setenv("FAIRBILL_SUPABASE_URL", "https://fairbill-test.supabase.co")
    monkeypatch.setenv("FAIRBILL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fictional_web")
    monkeypatch.setenv("FAIRBILL_SUPABASE_SERVICE_KEY", "fictional-server-only")
    monkeypatch.delenv("FAIRBILL_WEB_PATIENT", raising=False)
    with TestClient(app) as client:
        assert client.get("/patient").status_code == 404
        monkeypatch.setenv("FAIRBILL_WEB_PATIENT", "1")
        response = client.get("/patient")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert "noindex" in response.headers["x-robots-tag"]
        assert "https://fairbill-test.supabase.co" in response.headers["content-security-policy"]
        assert "sb_publishable_fictional_web" in response.text
        assert "fictional-server-only" not in response.text
        assert "localStorage" not in response.text and "sessionStorage" not in response.text
        monkeypatch.setenv("FAIRBILL_SUPABASE_URL", "https://fairbill-test.supabase.co/evil")
        assert client.get("/patient").status_code == 404
