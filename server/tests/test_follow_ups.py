import pytest
from fastapi.testclient import TestClient

from fairbill.api import app

AUTH = {"Authorization": f"Bearer {'a' * 64}"}
OTHER = {"Authorization": f"Bearer {'b' * 64}"}


@pytest.fixture
def case_api(tmp_path, monkeypatch):
    monkeypatch.setenv("FAIRBILL_PROFILE", "local")
    monkeypatch.setenv("FAIRBILL_DB", str(tmp_path / "follow-ups.sqlite"))
    with TestClient(app, headers=AUTH) as client:
        result = client.post("/v1/cases", json={"sample": False})
        assert result.status_code == 201
        case = result.json()
        yield client, f"/v1/cases/{case['id']}"


def test_follow_ups_are_private_durable_and_idempotent(case_api):
    client, path = case_api
    request = {"revision": 1, "title": "Ask billing for an itemised statement", "due_on": "2026-12-01"}
    add = path + "/follow-ups"
    key = {"Idempotency-Key": "add-1"}
    first = client.post(add, json=request, headers=key)
    assert first.status_code == 200
    assert client.post(add, json=request, headers=key).json() == first.json()
    assert client.post(add, json={**request, "title": "Different task"}, headers=key).status_code == 409
    entry, = first.json()["follow_ups"]
    assert entry["status"] == "open" and entry["due_on"] == "2026-12-01"
    assert client.post(add, json=request, headers={**OTHER, **key}).status_code == 404

    update = add + "/" + entry["id"]
    result = {"revision": 1, "due_on": entry["due_on"], "status": "completed", "reference": "QA-210",
              "outcome": "The office supplied the requested statement.", "confirmed": True}
    assert client.patch(update, json=result, headers={**OTHER, "Idempotency-Key": "foreign"}).status_code == 404
    saved = client.patch(update, json=result, headers={"Idempotency-Key": "finish-1"})
    assert saved.status_code == 200
    assert client.patch(update, json=result, headers={"Idempotency-Key": "finish-1"}).json() == saved.json()
    same = client.patch(update, json=result, headers={"Idempotency-Key": "finish-2"}).json()
    assert same == saved.json()
    assert client.get(path).json() == same
    assert [event["title"] for event in same["timeline"] if "Follow-up" in event["title"]] == [
        "Follow-up added", "Follow-up updated",
    ]
    assert same["revision"] == 1 and same["receipts"] == {}
    assert same["follow_ups"][0]["reference"] == "QA-210"
    assert "QA-210" not in str(same["timeline"])


def test_follow_up_checks_date_revision_and_explicit_outcome_confirmation(case_api):
    client, path = case_api
    base = path + "/follow-ups"
    valid = {"revision": 1, "title": "Billing follow-up", "due_on": "2026-12-01"}
    key = {"Idempotency-Key": "start"}
    assert client.post(base, json={**valid, "due_on": "2026-02-31"}, headers=key).status_code == 422
    assert client.post(base, json={**valid, "revision": 2}, headers=key).status_code == 409
    saved = client.post(base, json=valid, headers=key).json()
    ident = saved["follow_ups"][0]["id"]
    path = base + "/" + ident
    finished = {"revision": 1, "status": "completed", "due_on": "2026-12-01", "outcome": "Response received."}
    for value in (False, 1, "true", None):
        assert client.patch(path, json={**finished, "confirmed": value},
                            headers={"Idempotency-Key": "save"}).status_code == 422
    assert client.patch(path, json={**finished, "confirmed": True, "outcome": ""},
                        headers={"Idempotency-Key": "save"}).status_code == 422
    reopened = client.patch(path, json={**finished, "status": "open", "due_on": "2026-12-02", "outcome": "",
                                       "confirmed": True}, headers={"Idempotency-Key": "reschedule"})
    assert reopened.status_code == 200
    assert reopened.json()["follow_ups"][0]["due_on"] == "2026-12-02"
