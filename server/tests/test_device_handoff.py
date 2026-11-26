import pytest

from test_report_links import AUTH, OTHER, reviewed


@pytest.mark.parametrize("action", ["letter", "call"])
def test_device_handoff_checks_exact_approval_and_records_no_delivery(reviewed, action):
    client, path, revision = reviewed
    draft = client.post(path + "/drafts", headers=AUTH, json={
        "action": action, "revision": revision,
    }).json()["drafts"][action]
    approval = {"action": action, "revision": revision, "hash": draft["hash"]}
    request = {**approval, "confirmed": True}
    handoff = path + "/handoffs/authorize"
    withdraw = path + "/approvals/withdraw"
    key = {**AUTH, "Idempotency-Key": "device-handoff-1"}
    assert client.post(handoff, headers=AUTH, json=request).status_code == 400
    assert client.post(handoff, headers=key, json={**request, "confirmed": 1}).status_code == 422
    assert client.post(handoff, headers=key, json=request).status_code == 409
    assert client.post(path + "/approvals", headers=AUTH, json=approval).status_code == 200

    for stale in ({"hash": "0" * 64}, {"revision": revision - 1}, {"action": "call" if action == "letter" else "letter"}):
        assert client.post(handoff, headers=key, json={**request, **stale}).status_code == 409
    stranger = {**OTHER, "Idempotency-Key": "other-handoff"}
    assert client.post(handoff, headers=stranger, json=request).status_code == 404
    assert client.post(withdraw, headers=OTHER, json=approval).status_code == 404

    for _ in range(2):
        result = client.post(handoff, headers=key, json=request)
        assert result.status_code == 200
        snapshot = result.json()
        assert not snapshot["receipts"]
        assert sum(e["title"] == f"{action.title()} handoff authorized" for e in snapshot["timeline"]) == 1
    for _ in range(2):
        result = client.post(withdraw, headers=AUTH, json=approval)
        assert result.status_code == 200
        snapshot = result.json()
        assert action not in snapshot["approvals"]
        assert sum(e["title"] == f"{action.title()} approval withdrawn" for e in snapshot["timeline"]) == 1
    assert client.post(handoff, headers=key, json=request).status_code == 409
