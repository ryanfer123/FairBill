import pytest
from fastapi.testclient import TestClient

from fairbill.api import app
from fairbill.v1 import cloud, store

AUTH = {"Authorization": f"Bearer {'a' * 64}"}
OTHER = {"Authorization": f"Bearer {'b' * 64}"}
OWNER = "10000000-0000-4000-8000-000000000001"
GUEST = "10000000-0000-4000-8000-000000000002"
PATH = "/v1/guest-reviews/adopt"
INPUT = {"guest_id": GUEST, "owner_id": OWNER, "consent": True, "invoice_total": 74000, "rows": [
    {"description": "Consultation", "units": 1, "amount": 50000},
    {"description": "Blood count", "units": 2, "amount": 24000},
]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FAIRBILL_PROFILE", "local")
    monkeypatch.setenv("FAIRBILL_DB", str(tmp_path / "guest.db"))
    monkeypatch.setenv("FAIRBILL_DOCUMENT_STORE", str(tmp_path / "originals"))
    with TestClient(app, headers=AUTH) as http:
        yield http


def test_guest_adoption_is_explicit_private_and_idempotent(client, tmp_path):
    for value in (False, 1, "true", None):
        assert client.post(PATH, json={**INPUT, "consent": value}).status_code == 422
    assert client.get("/v1/cases").json()["cases"] == []
    saved = client.post(PATH, json=INPUT)
    assert saved.status_code == 200, saved.json()
    result = saved.json()
    case_id = result["id"]
    doc, = result["documents"]
    assert not doc["confirmed"] and doc["media_type"] == "text/plain"
    assert [row["amount"] for row in doc["rows"]] == [50000, 24000, 74000]
    assert "On-device ledger supplied by the patient" in doc["pages"][0]
    assert not (tmp_path / "originals").exists()
    assert "guest_fingerprint" not in result
    assert client.post(PATH, json=INPUT).json()["id"] == case_id
    with store.connection() as conn, conn:
        conn.execute("DELETE FROM request_replays_v1")
    assert client.post(PATH, json=INPUT).json()["id"] == case_id
    assert client.post(PATH, json={**INPUT, "invoice_total": 90000}).status_code == 409
    assert client.get(f"/v1/cases/{case_id}", headers=OTHER).status_code == 404
    confirmed = client.post(f"/v1/cases/{case_id}/documents/{doc['id']}/confirm", json={"revision": result["revision"]})
    assert confirmed.status_code == 200
    investigation = client.post(f"/v1/cases/{case_id}/investigate", json={"revision": confirmed.json()["revision"]})
    assert investigation.json()["scenario"]["billed"] == 74000


def test_hosted_adoption_requires_the_intended_owner(monkeypatch):
    monkeypatch.setenv("FAIRBILL_PROFILE", "hosted")
    monkeypatch.setattr(cloud, "authenticate", lambda _: "10000000-0000-4000-8000-000000000003")
    monkeypatch.setattr(store, "mutate", lambda *args: pytest.fail("Unexpected transfer to another account"))
    with TestClient(app, headers=AUTH) as client:
        assert client.post(PATH, json=INPUT).status_code == 409
