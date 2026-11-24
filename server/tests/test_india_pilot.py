"""Invented records based on published sources. No patient data."""

import pytest

from test_v1_workflow import AUTH, OTHER, client, new_case, operation


def attach(client, case, kind, text, confirm=True):
    case = operation(client, case, "documents/text", kind=kind, text=text)
    doc = case["documents"][-1]
    if confirm:
        case = operation(client, case, f"documents/{doc['id']}/confirm")
    return case, doc["id"]


def pilot(client, case, **payload):
    return client.post(f"/v1/cases/{case['id']}/india-review", json={"revision": case["revision"], **payload})


def tariff(invoice, **extra):
    return {"review": "tariff", "invoice_id": invoice, "edition": "tmh-parel-2026-11-01-v6",
            "confirmed_applicability": True, "category": "C", **extra}


def test_published_prices_are_revision_scoped_and_excluded_from_savings(client):
    text = "\n".join([
        "CHARGE|room|Room bed per day|B001|2026-11-20|2|500|1000",
        "CHARGE|icu|ICU per day|B003|2026-11-22|1|840|840",
        "CHARGE|prior|Room bed per day|B001|2026-10-30|1|500|500",
        "CHARGE|outside|Room bed per day|B001|2026-11-24|2|500|1000",
        "CHARGE|bad-math|Room bed per day|B001|2026-11-22|2|300|850",
        "CHARGE|unknown|Other service|X1|2026-11-22|1|500|500",
        "TOTAL|total|Total billed|4690",
    ])
    case, invoice = attach(client, new_case(client, sample=False), "invoice", text)
    result = pilot(client, case, **tariff(invoice))
    assert result.status_code == 200, result.text
    found = result.json()["findings"]
    assert [(f["billed_paise"], f["reference_paise"], f["difference_paise"]) for f in found] == [
        (100000, 84000, 16000), (84000, 84000, 0),
    ]
    assert found[0]["record"]["line"] == 1 and found[0]["record"]["quote"] == text.splitlines()[0]
    assert found[0]["source_url"].startswith("https://tmc.gov.in/")
    assert pilot(client, case, **tariff(invoice, confirmed_applicability=False)).status_code == 422
    assert pilot(client, case, **tariff(invoice, edition="other")).status_code == 422
    path = f"/v1/cases/{case['id']}"
    assert client.get(path, headers=AUTH).json() == case
    payload = {"revision": case["revision"], **tariff(invoice)}
    assert client.post(path + "/india-review", json=payload, headers=OTHER).status_code == 404
    case = operation(client, case, "investigate")
    assert client.post(path + "/india-review", json=payload).status_code == 409
    assert not any("Published daily rate" in finding["title"] for finding in case["findings"])


def test_assistance_requires_confirmed_invoice_and_handles_hospital_categories(client):
    case, invoice = attach(client, new_case(client, sample=False), "invoice", "TOTAL|total|Total billed|500", confirm=False)
    aid = {"review": "aid", "invoice_id": invoice, "hospital": "tmh-parel", "category": "C"}
    assert pilot(client, case, **aid).status_code == 422
    case = operation(client, case, f"documents/{invoice}/confirm")
    for category, phrase in (("C", "means assessment"), ("NC", "NC category was applied"), ("BP", "scheme desk")):
        response = pilot(client, case, **{**aid, "category": category})
        assert response.status_code == 200
        finding, = response.json()["findings"]
        assert phrase in finding["detail"]
        assert "section 14.2" in finding["citation"]
        assert finding["difference_paise"] is None
    assert pilot(client, case, **{**aid, "hospital": "other"}).status_code == 422
    assert pilot(client, new_case(client), **aid).status_code == 422


@pytest.mark.parametrize("uin", ["NIAHLIP25040V082425", "NIAHLIP25040V102425"])
def test_insurance_requires_selected_policy_version_and_matching_documents(client, uin):
    case, invoice = attach(client, new_case(client, sample=False), "invoice", "TOTAL|a|Total|12300")
    case, policy = attach(client, case, "policy", f"UIN {uin}\nCLAUSE|a|Room category restrictions|3.2")
    case, settlement = attach(client, case, "settlement",
        "DEDUCTION|d|Proportionate deduction for room rent|400|3.2\nDEDUCTION|d2|Copayment|200|7")
    payload = dict(review="insurance", invoice_id=invoice, settlement_id=settlement, policy_id=policy,
                   uin=uin, confirmed_applicability=True)
    result = pilot(client, case, **payload)
    assert result.status_code == 200, result.text
    finding, = result.json()["findings"]
    assert uin in finding["citation"] and "3.2" in finding["citation"]
    assert finding["source_url"].startswith("https://www.newindia.co.in/")
    assert finding["record"]["document_id"] == settlement
    assert finding["reference_paise"] is None and finding["difference_paise"] is None
    other = "NIAHLIP25040V082425" if uin.endswith("102425") else "NIAHLIP25040V102425"
    assert pilot(client, case, **{**payload, "uin": other}).status_code == 422
    assert pilot(client, case, **{**payload, "settlement_id": policy}).status_code == 422
    assert pilot(client, case, **{**payload, "confirmed_applicability": False}).status_code == 422


def test_synthetic_itemised_pdf_requires_confirmation_before_comparison(client):
    import pymupdf

    case = new_case(client, sample=False)
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), "Synthetic test invoice - Tata Memorial Hospital, Parel")
        page.insert_text((72, 96), "Category C  |  Service date 20/11/2026")
        page.insert_text((72, 126), "Code      Description                 Days    Rate INR    Amount INR")
        page.insert_text((72, 148), "B001      Room / bed tariff              2        500.00       1,000.00")
        upload = client.post(f"/v1/cases/{case['id']}/documents/file",
            data={"kind": "invoice", "revision": case["revision"]},
            files={"file": ("synthetic-invoice.pdf", pdf.tobytes(), "application/pdf")})
    assert upload.status_code == 200, upload.text
    case = upload.json()
    doc = case["documents"][-1]
    assert not doc["rows"] and not doc["confirmed"]
    assert pilot(client, case, **tariff(doc["id"])).status_code == 422
    number, source = next((i, line) for i, line in enumerate(doc["pages"][0].splitlines(), 1) if "B001" in line)
    case = operation(client, case, f"documents/{doc['id']}/confirm", rows=[{
        "id": "room", "type": "charge", "page": 1, "line": number, "description": "Room / bed tariff",
        "code": "B001", "service_date": "2026-11-20", "units": 2, "unit_price": 50000, "amount": 100000,
    }])
    response = pilot(client, case, **tariff(doc["id"]))
    assert response.status_code == 200, response.text
    finding, = response.json()["findings"]
    assert finding["record"]["quote"] == source.strip()
    assert finding["difference_paise"] == 16000
