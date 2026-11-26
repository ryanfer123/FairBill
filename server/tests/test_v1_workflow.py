import hashlib
import io
import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

from fairbill.api import app

AUTH = {"Authorization": f"Bearer {'a' * 64}"}
OTHER = {"Authorization": f"Bearer {'b' * 64}"}
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FAIRBILL_DB", str(tmp_path / "cases.db"))
    monkeypatch.setenv("FAIRBILL_DOCUMENT_STORE", str(tmp_path / "originals"))
    monkeypatch.setenv("FAIRBILL_PROFILE", "local")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with TestClient(app, headers=AUTH, client=(tmp_path.name, 50000)) as http:
        yield http


def operation(client, case, endpoint, **fields):
    response = client.post(f"/v1/cases/{case['id']}/{endpoint}", json={"revision": case["revision"], **fields})
    assert response.status_code == 200, response.text
    return response.json()


def new_case(client, **options):
    response = client.post("/v1/cases", json=options)
    assert response.status_code == 201, response.text
    return response.json()


def checked(client):
    return operation(client, new_case(client), "investigate")


def test_v1_demo_diff_and_immutable_snapshots(client):
    initial = checked(client)
    assert initial["scenario"]["billed"] == 15680000
    assert initial["scenario"]["conditional"] == 15540000
    assert initial["scenario"]["unresolved_deduction"] == 1200000
    assert all(initial["scenario"]["sources"][field] for field in (
        "billed", "adjustments", "conditional", "unresolved_deduction",
    ))
    order = operation(client, initial, "documents/sample-order")
    confirmed = operation(client, order, "documents/second-order/confirm")
    latest = operation(client, confirmed, "investigate")
    assert latest["scenario"]["conditional"] == 15630000
    assert latest["scenario"]["adjustments"] == 50000
    assert latest["scenario"]["unresolved_deduction"] == 1200000
    path = f"/v1/cases/{latest['id']}"
    previous, current = initial["revision"], latest["revision"]
    assert len(client.get(path + "/revisions").json()) == 2
    diff = client.get(f"{path}/revisions/{previous}/diff/{current}").json()
    withdrawal = next(item for item in diff["changes"] if item["before"]["check"] == "duplicates")
    assert withdrawal["before"]["status"] == "active"
    assert withdrawal["after"]["status"] == "withdrawn"
    assert client.get(f"{path}/findings/{withdrawal['id']}", params={"revision": previous}).json() == withdrawal["before"]
    repeated = operation(client, latest, "investigate")
    assert repeated["revision"] > latest["revision"]
    assert repeated["scenario"]["conditional"] == latest["scenario"]["conditional"]
    assert len(client.get(path + "/revisions").json()) == 3

    with sqlite3.connect(os.environ["FAIRBILL_DB"]) as conn:
        rows = conn.execute("SELECT serial, snapshot FROM case_snapshots_v1 ORDER BY serial").fetchall()
    revisions = [json.loads(row[1]) for row in rows]
    assert any(snapshot["scenario"] == initial["scenario"] for snapshot in revisions)
    assert any(snapshot["scenario"] == latest["scenario"] for snapshot in revisions)


def test_idempotency_and_owner_scope(client):
    headers = {"Idempotency-Key": "initial-case", "X-Request-ID": "trace-test"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        requests = list(pool.map(lambda _: client.post("/v1/cases", json={}, headers=headers), range(2)))
    first, second = requests
    assert first.status_code == second.status_code == 201
    assert first.headers["X-Request-ID"] == "trace-test"
    assert first.json() == second.json()
    ident = first.json()["id"]
    conflict = client.post("/v1/cases", json={"sample": False}, headers=headers)
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "conflict"
    assert client.get(f"/v1/cases/{ident}", headers=OTHER).status_code == 404
    assert client.get("/v1/cases", headers=OTHER).json()["cases"] == []
    assert len(client.get("/v1/cases").json()["cases"]) == 1
    assert client.get("/v1/cases", headers={"Authorization": ""}).status_code == 401
    path = f"/v1/cases/{ident}/investigate"
    replay = {"Idempotency-Key": "investigate-1"}
    a = client.post(path, json={"revision": first.json()["revision"]}, headers=replay)
    b = client.post(path, json={"revision": first.json()["revision"]}, headers=replay)
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert len(b.json()["history"]) == 1


def test_exact_edit_and_send_receipt(client):
    case = operation(client, checked(client), "drafts", action="letter")
    old_draft = case["drafts"]["letter"]
    case = operation(client, case, "approvals", action="letter", hash=old_draft["hash"])
    prefix = f"/v1/cases/{case['id']}"
    exact_text = "  Please verify the two service orders.\n"
    updated = client.patch(prefix + "/drafts/letter", json={"revision": case["revision"], "text": exact_text})
    assert updated.status_code == 200, updated.text
    case = updated.json()
    assert case["approvals"] == {}
    draft = case["drafts"]["letter"]
    assert draft["hash"] == hashlib.sha256(exact_text.encode()).hexdigest()
    assert draft["text"] == exact_text
    assert draft["version"] == old_draft["version"] + 1
    assert [entry["hash"] for entry in case["draft_history"]] == [old_draft["hash"], draft["hash"]]
    action = {"revision": case["revision"], "action": "letter", "hash": draft["hash"]}
    assert client.post(prefix + "/simulations", json=action).status_code == 403
    assert client.post(prefix + "/simulations", json={**action, "hash": old_draft["hash"]}).status_code == 409
    case = operation(client, case, "approvals", action="letter", hash=draft["hash"])
    case = operation(client, case, "simulations", action="letter", hash=draft["hash"])
    receipt = next(iter(case["receipts"].values()))
    assert receipt["simulated"] and receipt["channel"] == "letter"
    assert receipt["hash"] == case["approvals"]["letter"]["hash"]
    assert receipt["at"]


def call(client):
    case = operation(client, checked(client), "drafts", action="call")
    action = {"action": "call", "hash": case["drafts"]["call"]["hash"]}
    case = operation(client, case, "approvals", **action)
    case = operation(client, case, "simulations", **action)
    return case, action


def test_call_identity_gate_and_scripted_transcript(client):
    case, action = call(client)
    prefix = f"/v1/cases/{case['id']}"
    assert client.post(prefix + "/simulations", json={"revision": case["revision"], **action, "step": "finish"}).status_code == 409
    first = next(iter(case["receipts"].values()))
    assert first["progress"] == "IDENTITY_PENDING"
    assert not any(turn["speaker"] == "advocate" for turn in first["turns"])
    case = operation(client, case, "simulations", step="identity", **action)
    assert next(iter(case["receipts"].values()))["progress"] == "IDENTITY_VERIFIED"
    case = operation(client, case, "simulations", step="activate", **action)
    active = next(iter(case["receipts"].values()))
    assert active["progress"] == "ADVOCATE_ACTIVE"
    assert active["turns"][-1]["text"] == case["drafts"]["call"]["text"]
    case = operation(client, case, "simulations", step="finish", **action)
    ended = next(iter(case["receipts"].values()))
    assert ended["state"] == "completed"
    assert ended["progress"] == "ENDED"
    assert ended["id"] in ended["turns"][-1]["text"]
    assert ended["simulated"]
    assert all(turn["simulated"] and turn["at"] for turn in ended["turns"])

    case, action = call(client)
    for _ in range(3):
        case = operation(client, case, "simulations", step="identity_failed", **action)
    receipt = next(iter(case["receipts"].values()))
    assert receipt["outcome"] == "identity_failed"
    assert receipt["progress"] == "ENDED"
    assert all(turn["speaker"] != "advocate" for turn in receipt["turns"])


def test_v1_document_observations_and_original_storage(client, tmp_path):
    case = new_case(client, sample=False)
    path = f"/v1/cases/{case['id']}"
    fixture = ROOT / "demo" / "invoice.pdf"
    upload = client.post(
        path + "/documents/file", data={"revision": case["revision"], "kind": "invoice"},
        files={"file": (fixture.name, fixture.read_bytes(), "application/pdf")},
    )
    assert upload.status_code == 200, upload.text
    case = upload.json()
    doc = case["documents"][0]
    assert len(doc["pages"]) > 1
    assert doc["extracted_lines"][0]["bbox"]
    assert doc["sha256"] == hashlib.sha256(fixture.read_bytes()).hexdigest()
    assert list((tmp_path / "originals").glob(f"*/*/{doc['id']}"))[0].read_bytes() == fixture.read_bytes()
    rows = doc["rows"]
    charge = next(row for row in rows if row["type"] == "charge" and row["unit_price"] is not None)
    charge["amount"] += 1
    case = operation(client, case, f"documents/{doc['id']}/confirm", rows=rows)
    case = operation(client, case, "investigate")
    assert any(finding["check"] == "line_arithmetic" for finding in case["findings"])
    assert all(finding["kind"] == "billing_question" and finding["evidence"] for finding in case["findings"])


def test_device_ocr_upload_preserves_original_and_requires_patient_confirmation(client, tmp_path):
    case = new_case(client, sample=False)
    path = f"/v1/cases/{case['id']}"
    image = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 20, 20), False).tobytes("png")
    text = "Currency: INR\nDescription Qty Rate Amount\nConsultation 1 500.00 500.00\nTotal 500.00"
    fields = {"revision": case["revision"], "kind": "invoice", "device_ocr_text": text}
    files = {"file": ("bill.png", image, "image/png")}
    headers = {"Idempotency-Key": "device-ocr-upload"}
    upload = client.post(path + "/documents/file", data=fields, files=files, headers=headers)
    assert upload.status_code == 200, upload.text
    case = upload.json()
    document = case["documents"][0]
    assert document["extracted_lines"][0]["source"] == "device_ocr"
    assert not document["confirmed"]
    assert (next((tmp_path / "originals").glob(f"*/*/{document['id']}"))).read_bytes() == image
    replay = client.post(path + "/documents/file", data=fields, files=files, headers=headers)
    assert replay.status_code == 200 and replay.json() == case
    changed = client.post(path + "/documents/file", data={**fields, "device_ocr_text": text.replace("500", "200")},
                          files=files, headers=headers)
    assert changed.status_code == 409
    denied = client.post(path + "/investigate", json={"revision": case["revision"]})
    assert denied.status_code == 422
    confirmed = operation(client, case, f"documents/{document['id']}/confirm")
    investigated = operation(client, confirmed, "investigate")
    assert investigated["scenario"]["billed"] == 50000
    assert investigated["scenario"]["sources"]["billed"][0]["basis"] == "patient_confirmed"


def test_assistance_and_redacted_packet(client):
    case = checked(client)
    sample = operation(client, case, "assistance/sample")
    assert sample["simulated"]
    assert all(finding["source"]["quote"] and "still needs applicability review" in finding["explanation"]
               for finding in sample["findings"])
    case = operation(client, case, "drafts", action="letter")
    case = operation(client, case, "approvals", action="letter", hash=case["drafts"]["letter"]["hash"])
    uri = f"/v1/cases/{case['id']}/packet"
    response = client.get(uri, params={"revision": case["revision"], "preview": True})
    assert response.status_code == 200
    assert "Approved letter" in "\n".join(response.json()["lines"])
    pdf = client.get(uri, params={"revision": case["revision"]})
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")
    assert pdf.headers["Cache-Control"] == "no-store"


def test_packet_route_for_a_fresh_invoice_keeps_rupees_and_omits_private_source(client):
    case = new_case(client, sample=False)
    path = f"/v1/cases/{case['id']}"
    bill = ("Patient name: Nora QA Fixture\nEmail: packet-test@example.invalid\n"
            "Currency: INR\nDescription Qty Rate Amount\n"
            "Consultation 1 500.00 500.00\nBlood count 2 130.00 240.00\nGrand Total 740.00")
    uploaded = client.post(path + "/documents/text", headers={"Idempotency-Key": "fresh-packet"},
                           json={"revision": case["revision"], "kind": "invoice", "text": bill})
    assert uploaded.status_code == 200
    case = uploaded.json()
    document = case["documents"][0]
    assert "Nora QA Fixture" in document["pages"][0]
    case = operation(client, case, f"documents/{document['id']}/confirm")
    case = operation(client, case, "investigate")
    assert any(finding["check"] == "line_arithmetic" for finding in case["findings"])
    version = {"revision": case["revision"]}
    preview = client.get(path + "/packet", params={**version, "preview": True})
    exported = client.get(path + "/packet", params=version)
    assert preview.status_code == exported.status_code == 200
    assert exported.headers["Content-Type"] == "application/pdf"
    assert exported.headers["Cache-Control"] == "no-store"
    with pymupdf.open(stream=exported.content, filetype="pdf") as pdf:
        text = "\n".join(page.get_text() for page in pdf)
    for output in ("\n".join(preview.json()["lines"]), text):
        assert "Original invoice: ₹740.00" in output
        assert "Revision history" in output
        assert "Nora QA Fixture" not in output
        assert "packet-test@example.invalid" not in output


def test_fixture_profile_fail_closed(client, monkeypatch):
    monkeypatch.setenv("FAIRBILL_PROFILE", "fixtures")
    monkeypatch.setenv("FAIRBILL_INVITE_CODE", "test-invite")
    monkeypatch.setenv("GEMINI_API_KEY", "never-used")
    assert client.post("/cases", json={}).status_code == 404
    assert client.post("/v1/cases", json={}).status_code == 403
    client.headers["X-FairBill-Invite"] = "test-invite"
    assert client.post("/v1/cases", json={"sample": False}).status_code == 403
    case = checked(client)
    assert case["agent_mode"] == "Offline"
    uri = f"/v1/cases/{case['id']}"
    version = {"revision": case["revision"]}
    assert client.post(uri + "/documents/text", json={**version, "text": "fake", "kind": "invoice"}).status_code == 403
    assert client.post(uri + "/documents/file", data={**version, "kind": "invoice"},
                       files={"file": ("plain.txt", io.BytesIO(b"test"), "text/plain")}).status_code == 403
    assert client.patch(uri + "/drafts/letter", json={**version, "text": "free form"}).status_code == 403
    assert client.post(uri + "/assistance", json={**version, "annual_household_income_paise": 10,
                                                 "household_size": 1}).status_code == 403
    assert client.post(uri + "/assistance/sample", json=version).status_code == 200
    health = client.get("/v1/health").json()
    assert health == {"status": "ok", "demo": "synthetic", "profile": "fixtures", "mode": "Offline",
                      "ocr_available": False, "db": "ok"}


def test_request_limit_validation_and_health(client, monkeypatch):
    result = client.post("/v1/cases", json={"sample": "not-a-boolean"})
    assert result.status_code == 422
    assert result.json()["details"] == [{"field": "sample", "code": "bool_parsing"}]
    assert "X-Request-ID" in result.headers
    large = client.post("/v1/cases", headers={"Content-Length": "999999999"}, json={})
    assert large.status_code == 413
    assert large.json()["code"] == "too_large"
    health = client.get("/v1/health").json()
    assert health["mode"] == "Offline"
    assert health["db"] == "ok"
    monkeypatch.setenv("FAIRBILL_PROFILE", "fixtures")
    monkeypatch.setenv("FAIRBILL_REQUESTS_PER_MINUTE", "1")
    assert client.get("/v1/health").status_code == 503
    assert client.post("/v1/cases", json={}).status_code == 503
    assert client.post("/v1/cases", json={}).status_code == 429
    assert client.get("/v1/health").status_code == 503


def test_case_deletion_is_scoped_and_purges_source_and_replays(client, tmp_path):
    case = new_case(client, sample=False)
    path = f"/v1/cases/{case['id']}"
    response = client.post(path + "/documents/text", headers={"Idempotency-Key": "test-source"},
                           json={"kind": "invoice", "revision": 1, "text": "TOTAL|T|Payable|8"})
    assert response.status_code == 200
    doc = response.json()["documents"][0]
    original = next((tmp_path / "originals").rglob(doc["id"]))
    assert client.delete(path, headers=OTHER).status_code == 204
    assert client.get(path).status_code == 200
    assert original.exists()
    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 204
    assert client.get(path).status_code == 404
    assert not original.exists()
    with sqlite3.connect(os.environ["FAIRBILL_DB"]) as db:
        assert not db.execute("SELECT serial FROM case_snapshots_v1 WHERE case_id=?", (case["id"],)).fetchall()
        assert not db.execute("SELECT key FROM request_replays_v1 WHERE key='test-source'").fetchall()


def test_cancel_before_and_after_import(client, tmp_path):
    case = new_case(client, sample=False)
    path = f"/v1/cases/{case['id']}"
    first, second = "a" * 32, "b" * 32
    data = {"kind": "invoice", "revision": case["revision"], "text": "TOTAL|T|Payable|18"}
    cancel = lambda doc: client.post(f"{path}/imports/{doc}/cancel", json={"revision": data["revision"]})
    assert cancel(first).status_code == 200
    assert client.post(path + "/documents/text", json=data, headers={"Idempotency-Key": "import-" + first}).status_code == 409
    response = client.post(path + "/documents/text", json=data, headers={"Idempotency-Key": "import-" + second})
    assert response.status_code == 200 and response.json()["documents"][0]["id"] == second
    assert cancel(second).json()["documents"] == []
    assert not list((tmp_path / "originals").rglob(second))
    with sqlite3.connect(os.environ["FAIRBILL_DB"]) as db:
        assert not db.execute("SELECT 1 FROM case_snapshots_v1 WHERE snapshot LIKE '%TOTAL|T|Payable|18%'").fetchall()
        assert not db.execute("SELECT 1 FROM request_replays_v1 WHERE response LIKE '%TOTAL|T|Payable|18%'").fetchall()


def test_patient_pdf_and_new_lab_order_keep_separate_quantity_question(client):
    invoice = (
        "CHARGE | cbc1 | Blood count | CBC | 2026-11-01 | 1 | 500.00 | 500.00",
        "CHARGE | cbc2 | Blood count | CBC | 2026-11-01 | 1 | 500.00 | 500.00",
        "CHARGE | draw | Blood draws | DRAW | 2026-11-01 | 4 | 50.00 | 200.00",
        "TOTAL | total | Invoice total | 1200.00",
    )
    case = new_case(client, sample=False)
    path = f"/v1/cases/{case['id']}"
    with pymupdf.open() as source:
        page = source.new_page()
        page.insert_text((40, 60), "\n".join(invoice))
        response = client.post(path + "/documents/file", data={"kind": "invoice", "revision": case["revision"]},
                               files={"file": ("fictional-bill.pdf", source.tobytes(), "application/pdf")})
    assert response.status_code == 200, response.text
    case = response.json()
    bill, = case["documents"]
    assert not case["sample"] and not bill["confirmed"]
    assert len(bill["rows"]) == 4
    case = operation(client, case, f"documents/{bill['id']}/confirm", rows=bill["rows"])

    def add_record(case, text):
        case = operation(client, case, "documents/text", kind="service_record", text=text)
        doc = case["documents"][-1]
        return operation(client, case, f"documents/{doc['id']}/confirm", rows=doc["rows"]), doc["id"]

    case, first_record = add_record(case, "ORDER | first | Blood count | CBC | 2026-11-01 | 1 | ORDER-A\n"
                                         "QUANTITY | logged | Blood draws | DRAW | 2026-11-01 | 2 | LOG-A")
    first = operation(client, case, "investigate")
    assert first["scenario"]["billed"] == 120000
    assert first["scenario"]["conditional"] == 60000
    assert {item["check"] for item in first["findings"] if item["status"] == "active"} == {"duplicates", "quantities"}
    previous_draft = operation(client, first, "drafts", action="letter")["drafts"]["letter"]

    case, second_record = add_record(first, "ORDER | second | Blood count | CBC | 2026-11-01 | 1 | ORDER-B")
    current = operation(client, case, "investigate")
    assert current["scenario"]["billed"] == 120000
    assert current["scenario"]["conditional"] == 110000
    checks = {item["check"]: item for item in current["findings"]}
    assert checks["duplicates"]["status"] == "withdrawn"
    assert any(item["document_id"] == second_record and item["relation"] == "contradicts"
               for item in checks["duplicates"]["evidence"])
    assert checks["quantities"]["status"] == "active" and checks["quantities"]["amount"] == 10000
    assert {item["document_id"] for item in checks["quantities"]["evidence"]} == {first_record, bill["id"]}
    diff = client.get(f"{path}/revisions/{first['revision']}/diff/{current['revision']}").json()
    assert any(item["after"]["status"] == "withdrawn" for item in diff["changes"])

    assert client.post(path + "/approvals", json={
        "action": "letter", "revision": first["revision"], "hash": previous_draft["hash"],
    }).status_code == 409
    drafted = operation(client, current, "drafts", action="letter")
    draft = drafted["drafts"]["letter"]
    approved = operation(client, drafted, "approvals", action="letter", hash=draft["hash"])
    assert approved["approvals"]["letter"]["hash"] == draft["hash"]
    assert not approved["receipts"]
    result = client.get(path + "/packet", params={"revision": current["revision"]})
    assert result.status_code == 200
    with pymupdf.open(stream=result.content, filetype="pdf") as packet:
        text = "\n".join(page.get_text() for page in packet)
        assert "Quantity needs clarification" in text
        assert "₹1,100.00" in text
        assert not packet.embfile_names()


def test_case_list_cursor_returns_each_case_once(client):
    expected = {new_case(client, sample=False)["id"] for _ in range(22)}
    first = client.get("/v1/cases", params={"limit": 20})
    assert first.status_code == 200
    page = first.json()
    assert len(page["cases"]) == 20 and page["next_after"]
    second = client.get("/v1/cases", params={"limit": 20, "after": page["next_after"]})
    assert second.status_code == 200
    end = second.json()
    assert len(end["cases"]) == 2 and end["next_after"] is None
    ids = [item["id"] for item in (*page["cases"], *end["cases"])]
    assert len(ids) == len(set(ids)) == 22 and set(ids) == expected
