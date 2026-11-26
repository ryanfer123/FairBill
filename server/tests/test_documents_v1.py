import hashlib
import shutil
from pathlib import Path

import pymupdf
import pytest

from fairbill import resolution
from fairbill.documents import (
    ObservedRow,
    Row,
    excerpt,
    make_document,
    remove_original,
    store_original,
)
from fairbill.investigation import run
from fairbill.redaction import RedactionError
from fairbill.sample import fixtures

DEMO = Path(__file__).resolve().parents[2] / "demo"


def test_versioned_document_preserves_multipage_geometry():
    data = (DEMO / "invoice.pdf").read_bytes()
    document = make_document("invoice", "invoice", data, versioned=True, media_type="application/pdf")
    assert len(document["pages"]) == 2
    assert document["sha256"] == hashlib.sha256(data).hexdigest()
    assert document["media_type"] == "application/pdf"
    assert len(document["rows"]) == 5
    charge = next(row for row in document["rows"] if row["id"] == "L43")
    match = next(line for line in document["extracted_lines"] if line["page"] == charge["page"]
                 and line["line"] == charge["line"])
    assert match["raw_text"] == excerpt(document, charge)
    assert match["page"] == 2
    assert match["source"] == "pdf_text"
    assert len(match["bbox"]) == 4
    assert match["confidence"] is None
    assert not match["needs_manual_entry"]


def test_versioned_parser_preserves_recorded_arithmetic_and_manually_reviewed_text():
    data = (
        "｜CHARGE｜R01｜Consultation｜CONSULT｜2026-01-01｜2｜100｜300｜\n"
        "CHARGE | R02 | Missing fields\n"
        "TOTAL\tT01\tTotal\t300"
    ).encode()
    document = make_document("text", "invoice", data, pasted=True, versioned=True)
    assert document["rows"][0]["amount"] == 30000
    assert document["rows"][0]["units"] == 2
    assert document["rows"][0]["unit_price"] == 10000
    assert ObservedRow.model_validate(document["rows"][0])
    with pytest.raises(ValueError, match="quantity times unit price"):
        Row.model_validate(document["rows"][0])
    assert document["extracted_lines"][1]["needs_manual_entry"]
    assert document["extracted_lines"][1]["source"] == "paste"
    assert document["rows"][1]["type"] == "invoice_total"
    assert document["notes"] == ["Page 1, line 2 needs manual review."]


ITEMISED_BILL = "\n".join((
    "ITEMISED HOSPITAL BILL", "Currency: INR", "Description Qty Rate Amount",
    "Consultation 1 500.00 500.00", "Blood count 2 120.00 240.00", "Grand Total 740.00",
))


def test_ordinary_itemised_invoice_creates_reviewable_rows():
    document = make_document("bill", "invoice", ITEMISED_BILL.encode(), pasted=True, versioned=True)
    assert [(row["description"], row["units"], row["unit_price"], row["amount"]) for row in document["rows"]] == [
        ("Consultation", 1, 50000, 50000), ("Blood count", 2, 12000, 24000), ("Grand Total", None, None, 74000),
    ]
    assert [row["id"] for row in document["rows"]] == ["p1-l4", "p1-l5", "p1-l6"]
    assert [excerpt(document, row) for row in document["rows"]] == ITEMISED_BILL.splitlines()[3:]
    assert not any(row["code"] or row["service_date"] for row in document["rows"])
    assert not document["confirmed"]
    assert not make_document("bill", "settlement", ITEMISED_BILL.encode(), pasted=True, versioned=True)["rows"]
    assert not make_document("bill", "invoice", ITEMISED_BILL.encode(), pasted=True)["rows"]


def test_ordinary_invoice_ignores_summary_and_ambiguous_lines():
    data = "\n".join((
        "Miscellaneous 1 100 100", "S. No. | Description | Quantity | Unit Rate (Rs.) | Line Amount (INR)",
        "1 | Room 12 | | 900 | 900", "2 | Blood count | 2 | 120.50 | 240.00",
        "3 | CT | 1 | $750.00 | $750.00", "4 | Lab work | 1\N{VULGAR FRACTION ONE HALF} | 200 | 300",
        "Subtotal 240.00", "GST 1 0 0", "Discount 1 0 0", "Net Payable 240.00", "Invoice Total:240.00",
    )).encode()
    document = make_document("bill", "invoice", data, pasted=True, versioned=True)
    assert [(row["line"], row["type"], row["amount"]) for row in document["rows"]] == [
        (4, "charge", 24000), (11, "invoice_total", 24000),
    ]
    assert document["rows"][0]["unit_price"] == 12050
    assert document["extracted_lines"][2]["needs_manual_entry"]
    assert document["extracted_lines"][5]["needs_manual_entry"]


def test_ordinary_invoice_requires_stated_rupees_and_an_unambiguous_total():
    text = "Description Qty Rate Amount\nConsultation 1 500.00 500.00\nGrand Total 500.00"
    assert not make_document("bill", "invoice", text.encode(), pasted=True, versioned=True)["rows"]
    text = "Description Qty Rate Amount\nConsultation 1 Rs 500.00 INR 500.00\nGrand Total: ₹500.00\nTotal ₹500.00"
    document = make_document("bill", "invoice", text.encode(), pasted=True, versioned=True)
    assert [row["type"] for row in document["rows"]] == ["charge"]
    assert "More than one invoice total" in " ".join(document["notes"])


def test_ordinary_invoice_tolerates_ocr_qty_letter_confusion_only_in_header():
    data = ITEMISED_BILL.replace("Qty", "Oty").encode()
    document = make_document("bill", "invoice", data, pasted=True, versioned=True)
    assert len(document["rows"]) == 3


@pytest.mark.skipif(not shutil.which("tesseract"), reason="Tesseract is needed for local OCR")
def test_ordinary_itemised_invoice_from_real_ocr():
    with pymupdf.open() as pdf:
        page = pdf.new_page(width=550, height=320)
        page.insert_text((36, 45), ITEMISED_BILL, fontsize=22)
        image = page.get_pixmap(dpi=144).tobytes("png")
    document = make_document("bill", "invoice", image, versioned=True)
    assert [(row["type"], row["amount"]) for row in document["rows"]] == [
        ("charge", 50000), ("charge", 24000), ("invoice_total", 74000),
    ]
    assert all(line["source"] == "ocr" and line["bbox"] for line in document["extracted_lines"])


def test_rejects_invalid_media_encryption_and_oversized_dimensions():
    data = (DEMO / "invoice.pdf").read_bytes()
    with pytest.raises(ValueError, match="declared media type"):
        make_document("doc", "invoice", data, versioned=True, media_type="image/png")
    dimensions = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + (9000).to_bytes(4, "big") * 2
    with pytest.raises(ValueError, match="Image dimensions"):
        make_document("doc", "invoice", dimensions, versioned=True)
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        protected = pdf.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="synthetic-fixture")
    with pytest.raises(ValueError, match="unlocked PDF"):
        make_document("doc", "invoice", protected, versioned=True)


@pytest.mark.skipif(not shutil.which("tesseract"), reason="Tesseract is needed for local OCR")
@pytest.mark.parametrize("scan_kind", ["image/png", "image/jpeg", "application/pdf"])
def test_scans_keep_bounding_boxes_raw_lines_and_confidence(scan_kind):
    with pymupdf.open(DEMO / "scan-invoice.pdf") as printable:
        pixmap = printable[0].get_pixmap(matrix=pymupdf.Matrix(2.4, 2.4).prerotate(3))
    if scan_kind == "application/pdf":
        with pymupdf.open() as scanned:
            page = scanned.new_page(width=700, height=820)
            page.insert_image(page.rect, pixmap=pixmap, keep_proportion=True)
            payload = scanned.tobytes()
    else:
        payload = pixmap.tobytes(scan_kind.split("/")[-1])
    document = make_document("scan", "invoice", payload, versioned=True, media_type=scan_kind)
    assert sorted(row["type"] for row in document["rows"]) == ["charge", "invoice_total"]
    assert {row["amount"] for row in document["rows"]} == {150000}
    assert all(line["source"] == "ocr" and len(line["bbox"]) == 4 and 0 <= line["confidence"] <= 100
               for line in document["extracted_lines"])


def test_original_storage_is_private_scoped_and_cleans_up(tmp_path, monkeypatch):
    monkeypatch.setenv("FAIRBILL_DOCUMENT_STORE", str(tmp_path))
    data = (DEMO / "invoice.pdf").read_bytes()
    document = make_document("doc", "invoice", data, versioned=True)
    store_original("owner", "case-1", document, data)
    location = tmp_path / "owner" / "case-1" / "doc"
    assert location.read_bytes() == data
    assert location.stat().st_mode & 0o777 == 0o600
    assert location.parent.stat().st_mode & 0o777 == 0o700
    with pytest.raises(ValueError, match="document hash"):
        store_original("owner", "case-1", document, b"replacement")
    with pytest.raises(ValueError, match="storage identifier"):
        store_original("..", "case-1", document, data)
    remove_original("owner", "case-1", document)
    assert not location.exists()


def packet_case(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    case = {
        "documents": fixtures()[:4], "drafts": {}, "approvals": {}, "findings": [], "timeline": [],
        "pending": ["duplicates", "quantities", "settlement", "patient_report"],
        "investigated_revision": None, "history": [], "revision": 1, "sample": True,
    }
    run(case)
    return case


def test_packet_includes_only_hash_bound_approved_letter_and_removes_ids(monkeypatch):
    case = packet_case(monkeypatch)
    text = ("Request for clarification to Alex Sample.\n"
            "Phone: +91 70000 44221\nPolicy number: SAMPLE-42\n"
            "Address: 12 Synthetic Lane\nPlease review the itemised bill.")
    letter = {"revision": 1, "text": text, "hash": hashlib.sha256(text.encode()).hexdigest()}
    case["patient_name"] = "Alex Sample"
    preview, _ = resolution.redacted_packet(case, approved_letter=letter)
    assert "Approved letter | Simulation only" not in preview
    case["approvals"]["letter"] = letter
    preview, _ = resolution.redacted_packet(case, approved_letter={**letter, "hash": "wrong"})
    assert "Approved letter | Simulation only" not in preview
    preview, packet = resolution.redacted_packet(case, approved_letter=letter)
    assert "Approved letter | Simulation only" in preview
    with pymupdf.open(stream=packet, filetype="pdf") as pdf:
        rendered = "\n".join(page.get_text() for page in pdf)
    for value in ["Alex Sample", "70000 44221", "SAMPLE-42", "12 Synthetic Lane"]:
        assert value not in "\n".join(preview)
        assert value not in rendered
    assert "Evidence review" in rendered
    assert "Revision history" in rendered
    assert "Approved letter" in rendered
    assert "[redacted]" in rendered


def test_packet_fails_if_readback_contains_an_injected_known_value(monkeypatch):
    case = packet_case(monkeypatch)
    original_renderer = resolution.evidence_packet
    monkeypatch.setattr(resolution, "evidence_packet",
                        lambda lines: original_renderer([*lines, "Alex   Sample"]))
    with pytest.raises(RedactionError, match="identity redaction check"):
        resolution.redacted_packet(case, known_pii=["Alex Sample"])


def test_packet_redacts_common_unlabelled_identifiers(monkeypatch):
    case = packet_case(monkeypatch)
    text = "Name: Alex Sample\nSend records to Alex Sample at synthetic@example.invalid or 7000099999."
    letter = {"revision": 1, "text": text, "hash": hashlib.sha256(text.encode()).hexdigest()}
    case["approvals"]["letter"] = letter
    preview, _ = resolution.redacted_packet(case, approved_letter=letter)
    assert "Alex Sample" not in "\n".join(preview)
    assert "synthetic@example.invalid" not in "\n".join(preview)
    assert "7000099999" not in "\n".join(preview)


def test_model_claim_rejection_uses_template_and_records_reason(monkeypatch):
    case = packet_case(monkeypatch)
    monkeypatch.setattr(resolution, "gemini", lambda *args: resolution.Wording(
        opening="Please explain the INR 982341.00 charge.",
        closing=resolution.CLOSINGS[0],
    ))
    draft = resolution.make_draft(case, "letter")
    assert draft["mode"] == "Offline"
    assert draft["fallback_reason"] == "unsupported_claim"
    assert resolution.OPENINGS[0] in draft["text"]
    assert "982341" not in draft["text"]
    assert any(entry["detail"] == "unsupported_claim" for entry in case["timeline"])


def test_timed_out_image_retries_with_source_coordinates(monkeypatch):
    import subprocess
    from xml.etree import ElementTree
    from fairbill import document_media

    sizes = []

    def recognize(data):
        pixels = pymupdf.Pixmap(data)
        sizes.append((pixels.width, pixels.height))
        if len(sizes) == 1:
            raise subprocess.TimeoutExpired("tesseract", 25)
        return ElementTree.fromstring('<p class="ocr_line" title="bbox 5 10 50 25">'
                                      '<b class="ocrx_word">Test</b></p>')

    monkeypatch.setattr(document_media, "_hocr", recognize)
    original = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 200, 300), False)
    original.clear_with(255)
    lines = document_media._ocr_lines(original, pymupdf.Matrix(1, 1))
    assert sizes == [(200, 300), (100, 150)]
    assert lines[0]["bbox"] == [10, 20, 100, 50]
