import base64
import json
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient

from fairbill.api import app
from fairbill.v1 import cloud
from fairbill.v1.operations import make_case

OWNER = "10000000-0000-4000-8000-000000000001"
SESSION = "10000000-0000-4000-8000-000000000002"
CLAIMS = base64.urlsafe_b64encode(json.dumps({"sub": OWNER, "session_id": SESSION}).encode()).decode().rstrip("=")
TOKEN = f"mock.{CLAIMS}.signature"


@pytest.fixture
def hosted_client(monkeypatch):
    monkeypatch.setenv("FAIRBILL_PROFILE", "hosted")
    monkeypatch.setenv("FAIRBILL_SUPABASE_URL", "https://fairbill.example")
    monkeypatch.setenv("FAIRBILL_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_mock")
    monkeypatch.setenv("FAIRBILL_SUPABASE_SERVICE_KEY", "sb_secret_mock")

    def start(handler, name):
        def upstream(request):
            path = request.url.path
            if path == "/auth/v1/user":
                assert request.headers.get("authorization") == f"Bearer {TOKEN}"
                assert request.headers["apikey"] == "sb_publishable_mock"
                return httpx.Response(200, json={"id": OWNER})
            if path.startswith("/rest/v1/") or path.startswith("/auth/v1/admin/"):
                assert request.headers["apikey"] == "sb_secret_mock"
                assert "authorization" not in request.headers
            return handler(request)

        monkeypatch.setattr(cloud, "client", httpx.Client(transport=httpx.MockTransport(upstream)))
        return TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}, client=(name, 50000))

    return start


def test_hosted_requires_current_account_session(hosted_client):
    def upstream(request):
        assert request.url.path.endswith("/fairbill_validate_session")
        assert json.loads(request.content) == {"p_owner": OWNER, "p_session": SESSION}
        return httpx.Response(200, json=False)

    with hosted_client(upstream, "revoked-session") as client:
        assert client.get("/v1/cases").status_code == 401
        assert client.get("/cases").status_code == 404


def test_hosted_upload_preserves_original_after_ambiguous_commit(hosted_client):
    case = make_case(False)
    case_id = case["id"]
    committed = None
    uploaded = []

    def upstream(request):
        nonlocal committed
        path = request.url.path
        if path.endswith("/fairbill_validate_session"):
            return httpx.Response(200, json=True)
        if path.endswith("/fairbill_hosted_state"):
            return httpx.Response(200, json={"status": "ok", "replay": committed,
                                             "current": {"serial": 4, "snapshot": case}})
        if path.endswith("/fairbill_reserve_original"):
            return httpx.Response(200, json=True)
        if request.method == "POST" and path.startswith("/storage/v1/object/fairbill-originals/"):
            assert path.startswith(f"/storage/v1/object/fairbill-originals/{OWNER}/{case_id}/")
            assert request.headers["authorization"] == f"Bearer {TOKEN}"
            assert request.headers["apikey"] == "sb_publishable_mock"
            assert b"Mock itemised bill" in request.content
            uploaded.append(path)
            return httpx.Response(200, json={})
        assert path.endswith("/fairbill_commit_case")
        data = json.loads(request.content)
        assert data["p_expected"] == 4 and data["p_key"] == "upload-1"
        assert uploaded[-1].endswith(data["p_original"])
        assert UUID(data["p_snapshot"]["id"]) == UUID(case_id)
        committed = {"fingerprint": data["p_fingerprint"], "response": data["p_snapshot"]}
        raise httpx.ReadTimeout("Response lost after commit", request=request)

    with hosted_client(upstream, "ambiguous-commit") as client:
        path = f"/v1/cases/{case_id}/documents/text"
        data = {"revision": 1, "kind": "invoice", "text": "Mock itemised bill"}
        headers = {"Idempotency-Key": "upload-1"}
        assert client.post(path, json=data, headers=headers).status_code == 503
        result = client.post(path, json=data, headers=headers)
        assert result.status_code == 200
        assert result.json()["documents"][0]["media_type"] == "text/plain"
        modified = {**data, "text": "A different mock itemised bill"}
        assert client.post(path, json=modified, headers=headers).status_code == 409
        assert len(uploaded) == 1


def test_hosted_account_removes_files_before_auth_and_retries(hosted_client):
    files = [f"{OWNER}/mock-case/mock-document"]
    removes = 0
    auth_deleted = False

    def upstream(request):
        nonlocal removes, auth_deleted
        if request.url.path.endswith("/fairbill_validate_session"):
            return httpx.Response(200, json=not auth_deleted)
        if request.url.path.endswith("/fairbill_account_originals_for_deletion"):
            assert json.loads(request.content) == {"p_owner": OWNER}
            return httpx.Response(200, json=files)
        if request.url.path == "/storage/v1/object/fairbill-originals":
            assert request.method == "DELETE"
            assert json.loads(request.content) == {"prefixes": files}
            removes += 1
            if removes == 1:
                return httpx.Response(503)
            files.clear()
            return httpx.Response(200, json=[])
        assert request.url.path == f"/auth/v1/admin/users/{OWNER}"
        assert request.method == "DELETE"
        assert not files
        auth_deleted = True
        return httpx.Response(200, json={})

    with hosted_client(upstream, "delete-retry") as client:
        assert client.delete("/v1/account").status_code == 503
        assert not auth_deleted
        assert client.delete("/v1/account").status_code == 204
        assert auth_deleted
        assert client.delete("/v1/account").status_code == 401
