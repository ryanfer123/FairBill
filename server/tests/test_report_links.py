import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor

import pymupdf
import pytest
from fastapi.testclient import TestClient

from fairbill.api import app
from fairbill.v1 import report_links, store

AUTH = {"Authorization": f"Bearer {'a' * 64}"}
OTHER = {"Authorization": f"Bearer {'b' * 64}"}
PUBLIC = "/v1/shared-report"
BILL = (
    "Patient name: Synthetic Fixture\nEmail: person@example.invalid\n"
    "Currency: INR\nDescription Qty Rate Amount\nConsultation 1 500.00 500.00\nBlood count 2 130.00 240.00\nGrand Total 740.00"
)


@pytest.fixture
def reviewed(tmp_path, monkeypatch):
    monkeypatch.setenv("FAIRBILL_DB", str(tmp_path / "report.db"))
    monkeypatch.setenv("FAIRBILL_DOCUMENT_STORE", str(tmp_path / "originals"))
    monkeypatch.setenv("FAIRBILL_PROFILE", "local")
    monkeypatch.setenv("FAIRBILL_REPORT_SHARING", "1")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with TestClient(app, client=(tmp_path.name, 50000)) as client:
        case = client.post("/v1/cases", json={"sample": False}, headers=AUTH).json()
        path = f"/v1/cases/{case['id']}"
        case = client.post(path + "/documents/text", headers=AUTH, json={
            "kind": "invoice", "revision": case["revision"], "text": BILL,
        }).json()
        doc, = case["documents"]
        confirmation = client.post(path + f"/documents/{doc['id']}/confirm", headers=AUTH,
                                   json={"revision": case["revision"]})
        assert confirmation.status_code == 200, confirmation.json()
        case = confirmation.json()
        result = client.post(path + "/investigate", headers=AUTH, json={"revision": case["revision"]})
        assert result.status_code == 200
        yield client, path, result.json()["revision"]


def issue(reviewed, key="share-test", **changes):
    client, path, revision = reviewed
    return client.post(path + "/report-links", headers={**AUTH, "Idempotency-Key": key}, json={
        "revision": revision, "hours": 1, "consent": True, **changes,
    })


def access(client, token):
    return client.get(PUBLIC, headers={"Authorization": f"Bearer {token}"})


def test_default_off_and_explicit_consent(reviewed, monkeypatch):
    client, _, revision = reviewed
    monkeypatch.delenv("FAIRBILL_REPORT_SHARING")
    assert issue(reviewed).status_code == 404
    assert client.get("/shared-report").status_code == 404
    monkeypatch.setenv("FAIRBILL_REPORT_SHARING", "1")
    for consent in (False, 1, "true", None):
        assert issue(reviewed, consent=consent).status_code == 422
    assert issue(reviewed, revision=revision - 1).status_code == 409
    assert issue(reviewed, hours=169).status_code == 422


def test_report_links_are_private_and_bearer_only(reviewed, tmp_path, caplog):
    client, path, revision = reviewed
    caplog.set_level(logging.INFO, logger="uvicorn.error")
    created = issue(reviewed)
    assert created.status_code == 201
    token = created.json()["token"]
    assert len(token) == 43
    assert created.headers["cache-control"] == "no-store"
    with store.connection() as conn:
        digest, pinned = conn.execute("SELECT token_hash, revision FROM report_links").fetchone()
        assert digest == hashlib.sha256(token.encode()).hexdigest()
        assert pinned == revision
    assert token.encode() not in (tmp_path / "report.db").read_bytes()
    listing = client.get(path + "/report-links", headers=AUTH)
    assert listing.json() == [created.json()["link"]]
    assert not {"token", "token_hash", "case_id", "creation_key"} & listing.json()[0].keys()
    assert client.get(path + "/report-links", headers=OTHER).status_code == 404
    assert client.delete(path + "/report-links/" + listing.json()[0]["id"], headers=OTHER).status_code == 404
    assert client.get(PUBLIC, params={"token": token}).status_code == 404
    shell = client.get("/shared-report")
    assert shell.status_code == 200
    for header in ("cache-control", "x-robots-tag", "referrer-policy", "content-security-policy"):
        assert header in shell.headers
    for private in (token, "Synthetic Fixture", "₹740.00", path):
        assert private not in shell.text
    assert 'addEventListener(\'click\'' in shell.text
    downloaded = access(client, token)
    assert downloaded.headers["x-robots-tag"] == "noindex, nofollow, noarchive"
    assert downloaded.headers["cache-control"] == "no-store"
    assert downloaded.headers["content-disposition"].startswith("attachment")
    with pymupdf.open(stream=downloaded.content, filetype="pdf") as pdf:
        text = "".join(page.get_text() for page in pdf)
        assert "₹740.00" in text and "Line amount needs reconciliation" in text
        assert "Synthetic Fixture" not in text and "person@example.invalid" not in text
        assert "Blood count 2 130.00" not in text
        assert not pdf.embfile_names()
    assert token not in caplog.text


def test_creation_retry_produces_one_capability(reviewed):
    with ThreadPoolExecutor(max_workers=2) as workers:
        statuses = list(workers.map(lambda _: issue(reviewed).status_code, range(2)))
    assert sorted(statuses) == [201, 409]
    with store.connection() as conn:
        assert conn.execute("SELECT count(*) FROM report_links").fetchone() == (1,)
        assert conn.execute("SELECT count(*) FROM request_replays_v1 WHERE key = 'share-test'").fetchone() == (0,)


def test_revocation_is_idempotent(reviewed):
    client, path, _ = reviewed
    issued = issue(reviewed).json()
    link = path + "/report-links/" + issued["link"]["id"]
    assert access(client, issued["token"]).status_code == 200
    assert client.delete(link, headers=AUTH).status_code == 204
    assert client.delete(link, headers=AUTH).status_code == 204
    assert access(client, issued["token"]).status_code == 404
    assert client.get(path + "/report-links", headers=AUTH).json()[0]["status"] == "revoked"


def test_shared_pdf_uses_pinned_snapshot_through_unrelated_case_change(reviewed):
    client, path, revision = reviewed
    issued = issue(reviewed).json()
    before = access(client, issued["token"])
    # Preparing a draft advances the case serial without changing its evidence revision.
    result = client.post(path + "/drafts", headers=AUTH, json={"action": "letter", "revision": revision})
    assert result.status_code == 200
    after = access(client, issued["token"])
    for packet in (before, after):
        assert packet.status_code == 200
    with pymupdf.open(stream=before.content, filetype="pdf") as expected, \
         pymupdf.open(stream=after.content, filetype="pdf") as actual:
        assert [p.get_text() for p in actual] == [p.get_text() for p in expected]
        assert "Approved letter" not in actual[0].get_text()


@pytest.mark.parametrize("change", ["revoked_at", "expires_at", "edit", "delete"])
def test_inflight_download_rechecks_authorization(reviewed, monkeypatch, change):
    client, path, _ = reviewed
    issued = issue(reviewed).json()
    original = report_links.resolution.redacted_packet

    def change_while_rendering(*args, **kwargs):
        result = original(*args, **kwargs)
        if change == "delete":
            assert client.delete(path, headers=AUTH).status_code == 204
        elif change == "edit":
            with store.connection() as conn, conn:
                conn.execute("UPDATE cases SET snapshot = json_set(snapshot, '$.revision', 99)")
        else:
            with store.connection() as conn, conn:
                column = {"revoked_at": "revoked_at", "expires_at": "expires_at"}[change]
                conn.execute(f"UPDATE report_links SET {column} = 1")
        return result

    monkeypatch.setattr(report_links.resolution, "redacted_packet", change_while_rendering)
    assert access(client, issued["token"]).status_code == 404
    assert access(client, issued["token"]).status_code == 404
    if change == "delete":
        with store.connection() as conn:
            assert conn.execute("SELECT count(*) FROM report_links").fetchone() == (0,)
