import shutil

import pymupdf
import pytest
from fastapi.testclient import TestClient
from hypothesis import given, strategies as st

from fairbill.api import app
from fairbill.documents import paise
from fairbill.sample import INVOICE

AUTH = {"Authorization": f"Bearer {'a' * 64}"}
OTHER_AUTH = {"Authorization": f"Bearer {'b' * 64}"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FAIRBILL_DB", str(tmp_path / "cases.sqlite"))
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with TestClient(app, headers=AUTH) as http:
        yield http


def new_case(client, sample=True):
    response = client.post("/cases", json={"sample": sample})
    assert response.status_code == 201
    return response.json()


def operation(client, case, endpoint, **fields):
    response = client.post(f"/cases/{case['id']}{endpoint}", json={"revision": case["revision"], **fields})
    assert response.status_code == 200, response.text
    return response.json()


def checked_sample(client):
    return operation(client, new_case(client), "/investigate")


def add_order(client, case):
    case = operation(client, case, "/documents/sample-order")
    doc = case["documents"][-1]
    assert not doc["confirmed"]
    return operation(client, case, f"/documents/{doc['id']}/confirm", rows=doc["rows"])


def test_sample_replans_and_preserves_history(client):
    initial = checked_sample(client)
    assert initial["scenario"] == {
        "billed": 15680000, "reconciled": True, "adjustments": 140000,
        "conditional": 15540000, "unresolved_deduction": 1200000,
        "included": [item["id"] for item in initial["findings"] if item["adjustment"]],
    }
    revised = operation(client, add_order(client, initial), "/investigate")
    assert revised["scenario"]["conditional"] == 15630000
    assert revised["scenario"]["adjustments"] == 50000
    assert revised["scenario"]["unresolved_deduction"] == 1200000
    withdrawn = next(item for item in revised["findings"] if item["check"] == "duplicates")
    assert withdrawn["status"] == "withdrawn"
    assert withdrawn["amount"] is None
    assert any(source["row_id"] == "O2" and source["relation"] == "contradicts" for source in withdrawn["evidence"])
    assert revised["history"][0]["scenario"]["conditional"] == 15540000
    assert revised["history"][0]["findings"] == initial["findings"]
    assert [event["title"] for event in revised["timeline"] if event["revision"] == revised["revision"]].count(
        "Trace deductions to the insurance policy"
    ) == 0
    assert operation(client, revised, "/investigate")["timeline"] == revised["timeline"]


def test_patient_can_correct_rows_and_report_unreceived_service(client):
    case = new_case(client)
    invoice = case["documents"][0]
    invoice["rows"][0]["received"] = False
    invoice["rows"][0]["description"] = "Patient-corrected care package"
    case = operation(client, case, f"/documents/{invoice['id']}/confirm", rows=invoice["rows"])
    case = operation(client, case, "/investigate")
    reported = next(item for item in case["findings"] if item["check"] == "patient_report")
    assert reported["evidence"][0]["basis"] == "patient_confirmed"
    assert "Patient-corrected" not in reported["evidence"][0]["quote"]
    assert case["scenario"]["adjustments"] == 140000


def test_confirmed_policy_reference_and_invoice_mismatch(client):
    case = new_case(client, sample=False)
    for endpoint, body in [
        ("invoice", "CHARGE | C1 | Visit | VISIT | 2026-11-10 | 1 | 200 | 200\nTOTAL | T1 | Total | 300"),
        ("policy", "CLAUSE | P1 | Fictional terms | P-1"),
        ("settlement", "DEDUCTION | S1 | Deduction | 90 | P-1"),
    ]:
        case = operation(client, case, "/documents/text", kind=endpoint, text=body)
        doc = case["documents"][-1]
        case = operation(client, case, f"/documents/{doc['id']}/confirm", rows=doc["rows"])
    case = operation(client, case, "/investigate")
    assert case["scenario"]["billed"] == 30000
    assert case["scenario"]["conditional"] is None
    assert case["findings"][0]["status"] == "linked"
    assert {s["row_id"] for s in case["findings"][0]["evidence"]} == {"P1", "S1"}


def test_clean_invoice_and_pending_documents(client):
    case = new_case(client, sample=False)
    case = operation(client, case, "/documents/text", kind="invoice",
                     text="CHARGE | C1 | Visit | VISIT | 2026-11-10 | 1 | 250 | 250\nTOTAL | T1 | Total | 250")
    assert client.post(f"/cases/{case['id']}/investigate", json={"revision": case["revision"]}).status_code == 422
    doc = case["documents"][-1]
    with_duplicate = doc["rows"] + doc["rows"][:1]
    response = client.post(f"/cases/{case['id']}/documents/{doc['id']}/confirm",
                           json={"revision": case["revision"], "rows": with_duplicate})
    assert response.status_code == 422
    case = operation(client, case, f"/documents/{doc['id']}/confirm", rows=doc["rows"])
    case = operation(client, case, "/investigate")
    assert case["findings"] == []
    assert case["scenario"]["conditional"] == 25000


def test_unreadable_import_can_be_discarded(client):
    case = new_case(client, sample=False)
    case = operation(client, case, "/documents/text", kind="invoice", text="Unstructured image transcription")
    doc = case["documents"][0]
    case = operation(client, case, f"/documents/{doc['id']}/discard")
    assert case["documents"] == []


def test_duplicate_record_id_does_not_withdraw_duplicate(client):
    case = checked_sample(client)
    case = operation(client, case, "/documents/text", kind="service_record",
                     text="ORDER | O1COPY | Copy of lab order | CBC | 2026-11-10 | 1 | LAB-01")
    doc = case["documents"][-1]
    case = operation(client, case, f"/documents/{doc['id']}/confirm", rows=doc["rows"])
    assert operation(client, case, "/investigate")["scenario"]["conditional"] == 15540000


def test_approval_simulations_and_revision_gate(client):
    case = operation(client, checked_sample(client), "/drafts", action="letter")
    draft = case["drafts"]["letter"]
    base = {"revision": case["revision"], "action": "letter", "hash": draft["hash"]}
    path = f"/cases/{case['id']}"
    assert client.post(path + "/approvals", json={**base, "hash": "0" * 64}).status_code == 409
    assert client.post(path + "/simulations", json=base).status_code == 403
    case = operation(client, case, "/approvals", action="letter", hash=draft["hash"])
    sent = operation(client, case, "/simulations", action="letter", hash=draft["hash"])
    assert operation(client, sent, "/simulations", action="letter", hash=draft["hash"]) == sent
    case = operation(client, sent, "/drafts", action="call")
    call = case["drafts"]["call"]
    call_fields = {"action": "call", "hash": call["hash"]}
    case = operation(client, case, "/approvals", **call_fields)
    case = operation(client, case, "/simulations", **call_fields)
    assert client.post(path + "/simulations", json={"revision": case["revision"], **call_fields, "step": "finish"}).status_code == 409
    case = operation(client, case, "/simulations", step="identity", **call_fields)
    case = operation(client, case, "/simulations", step="finish", **call_fields)
    assert sorted(receipt["state"] for receipt in case["receipts"].values()) == ["completed", "completed"]
    changed = add_order(client, case)
    assert changed["approvals"] == {}
    assert client.post(path + "/simulations", json=base).status_code == 409


def test_redacted_export_and_case_isolation(client):
    case = new_case(client, sample=False)
    case = operation(client, case, "/documents/text", kind="invoice",
                     text="PRIVATE PATIENT NAME 987654321\n" + INVOICE)
    doc = case["documents"][-1]
    case = operation(client, case, f"/documents/{doc['id']}/confirm", rows=doc["rows"])
    case = operation(client, case, "/investigate")
    path = f"/cases/{case['id']}"
    assert client.get(path, headers=OTHER_AUTH).status_code == 404
    assert client.get(path, headers={"Authorization": "Bearer incorrect"}).status_code == 401
    result = client.get(path + "/packet", params={"revision": case["revision"]})
    assert result.status_code == 200
    with pymupdf.open(stream=result.content, filetype="pdf") as document:
        output = "".join(page.get_text() for page in document)
    assert "Redacted evidence packet" in output
    assert "Possible duplicate charge" in output
    assert "PRIVATE PATIENT NAME" not in output
    assert "987654321" not in output
    assert "Complete blood count" not in output


def test_file_upload_validation(client):
    case = new_case(client, sample=False)
    path = f"/cases/{case['id']}/documents/file"
    fields = {"revision": case["revision"], "kind": "invoice"}
    assert client.post(path, data=fields, files={"file": ("invoice.pdf", b"bad")}).status_code == 422
    with pymupdf.open() as document:
        page = document.new_page()
        page.insert_text((40, 40), "TOTAL | T1 | Hospital invoice | 50")
        encoded = document.tobytes()
    result = client.post(path, data=fields, files={"file": ("invoice.pdf", encoded, "application/pdf")})
    assert result.status_code == 200
    doc = result.json()["documents"][0]
    assert doc["rows"][0]["amount"] == 5000
    assert not doc["confirmed"]


@pytest.mark.skipif(not shutil.which("tesseract"), reason="Tesseract unavailable")
def test_photo_ocr_can_be_corrected(client):
    case = new_case(client, sample=False)
    with pymupdf.open() as document:
        page = document.new_page(width=680, height=260)
        page.insert_text((35, 70), "FAIRBILL SYNTHETIC INVOICE", fontsize=23, fontname="cour")
        page.insert_text((35, 120), "Care package 1500.00", fontsize=20, fontname="cour")
        encoded = page.get_pixmap(dpi=180).tobytes("png")
    response = client.post(f"/cases/{case['id']}/documents/file",
                           data={"revision": 1, "kind": "invoice"},
                           files={"file": ("invoice.png", encoded, "image/png")})
    assert response.status_code == 200, response.text
    case = response.json()
    doc = case["documents"][0]
    assert "1500.00" in doc["pages"][0]
    rows = [
        {"id": "MANUAL1", "type": "charge", "page": 1, "line": 2, "description": "Care package",
         "units": 1, "unit_price": 150000, "amount": 150000},
        {"id": "MANUAL2", "type": "invoice_total", "page": 1, "line": 2, "description": "Confirmed total", "amount": 150000},
    ]
    case = operation(client, case, f"/documents/{doc['id']}/confirm", rows=rows)
    assert operation(client, case, "/investigate")["scenario"]["conditional"] == 150000


def test_invalid_model_plan_and_wording_fall_back(client, monkeypatch):
    from fairbill import investigation, resolution

    monkeypatch.setattr(investigation, "gemini", lambda *_: investigation.Plan(checks=["invent_adjustment"]))
    monkeypatch.setattr(resolution, "gemini", lambda *_: investigation.Wording(opening="Refund INR 500000", closing=""))
    case = checked_sample(client)
    assert case["agent_mode"] == "Offline"
    assert case["scenario"]["conditional"] == 15540000
    case = operation(client, case, "/drafts", action="letter")
    assert case["drafts"]["letter"]["mode"] == "Offline"
    assert "500000" not in case["drafts"]["letter"]["text"]


def test_model_can_order_checks_without_setting_values(client, monkeypatch):
    from fairbill import investigation, resolution

    monkeypatch.setattr(investigation, "gemini", lambda *_: investigation.Plan(checks=list(reversed(investigation.CHECKS))))
    monkeypatch.setattr(resolution, "gemini", lambda *_: investigation.Wording(
        opening=resolution.OPENINGS[1], closing=resolution.CLOSINGS[1],
    ))
    case = checked_sample(client)
    assert case["agent_mode"] == "Gemini"
    assert case["scenario"]["conditional"] == 15540000
    assert case["timeline"][2]["title"] == investigation.LABELS["patient_report"]
    case = operation(client, case, "/drafts", action="letter")
    assert case["drafts"]["letter"]["mode"] == "Gemini"
    assert resolution.OPENINGS[1] in case["drafts"]["letter"]["text"]


@given(st.integers(min_value=0, max_value=10**12))
def test_paise_round_trip(value):
    integer, fraction = divmod(value, 100)
    assert paise(f"{integer:,}.{fraction:02d}") == value
