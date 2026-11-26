import hashlib
import shutil
from pathlib import Path

import pymupdf
import pytest

from fairbill import resolution
from fairbill import documents
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


def test_ordinary_invoice_maps_explicit_reordered_columns_and_later_page_total():
    first = "\n".join((
        "Service Date\tItem Description\tService Code\tLine Total (INR)\tUnits\tPrice Per Unit (Rs.)\tOrder ID",
        "2026-11-01\tTotal protein test\tTP\t1,200.00\t2\t600.00\tOP-1",
        "2026-11-01\tBad group number\tB\t1,20.00\t1\t120.00\tOP-2",
    ))
    second = "Currency: INR\nGrand Total: 1,200.00"
    document = make_document("bill", "invoice", f"{first}\f{second}".encode(), pasted=True, versioned=True)
    charge, total = document["rows"]
    assert (charge["description"], charge["code"], charge["service_date"], charge["reference"]) == (
        "Total protein test", "TP", "2026-11-01", "OP-1",
    )
    assert (charge["units"], charge["unit_price"], charge["amount"]) == (2, 60000, 120000)
    assert (total["page"], total["line"], total["amount"]) == (2, 2, 120000)
    assert document["extracted_lines"][2]["needs_manual_entry"]


def test_ordinary_invoice_accepts_aligned_columns_but_rejects_conflicting_currency():
    text = "Item Description    Qty    Rate (INR)    Amount (INR)\nBlood count    2    120.00    240.00"
    document = make_document("bill", "invoice", text.encode(), pasted=True, versioned=True)
    assert [row["amount"] for row in document["rows"]] == [24000]
    conflicting = f"Currency: USD\n{text}"
    document = make_document("bill", "invoice", conflicting.encode(), pasted=True, versioned=True)
    assert not document["rows"]
    assert "ambiguous currency" in document["notes"][0]


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


def test_device_ocr_validates_original_and_keeps_observations_unconfirmed(monkeypatch):
    png = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 20, 20), False).tobytes("png")

    def unexpected_ocr(_):
        pytest.fail("A complete device reading should not need hosted OCR.")

    monkeypatch.setattr(documents, "extract_image_lines", unexpected_ocr)
    document = make_document("bill", "invoice", png, versioned=True, trusted=True, device_ocr_text=ITEMISED_BILL)
    assert document["sha256"] == hashlib.sha256(png).hexdigest()
    assert not document["confirmed"] and not document["bundled"]
    assert all(record["source"] == "device_ocr" and record["bbox"] is None for record in document["extracted_lines"])
    assert "Compare each row with the original" in document["notes"][0]
    with pytest.raises(ValueError, match="The image could not be read"):
        make_document("bill", "invoice", png[:25], versioned=True, device_ocr_text=ITEMISED_BILL)


@pytest.mark.parametrize("hint", ["Mangled text", ITEMISED_BILL.rsplit("\n", 1)[0]])
def test_incomplete_device_recognition_falls_back_to_hosted_ocr(monkeypatch, hint):
    png = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 20, 20), False).tobytes("png")
    monkeypatch.setattr(documents, "extract_image_lines", lambda _: [
        {"raw_text": line, "source": "ocr", "bbox": None, "confidence": None} for line in ITEMISED_BILL.splitlines()
    ])
    document = make_document("bill", "invoice", png, versioned=True, device_ocr_text=hint)
    assert [row["amount"] for row in document["rows"]] == [50000, 24000, 74000]
    assert document["extracted_lines"][0]["source"] == "ocr"


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


def test_packet_preserves_rupee_symbol_and_paise():
    amounts = [0, 1, 123456789, -125]
    labels = [resolution.money(amount) for amount in amounts]
    assert labels == ["₹0.00", "₹0.01", "₹12,34,567.89", "−₹1.25"]
    with pymupdf.open(stream=resolution.evidence_packet(labels), filetype="pdf") as pdf:
        assert pdf[0].get_text().splitlines() == labels


def test_packet_draws_the_rupee_outline_from_the_mobile_face():
    expected_font = DEMO.parent / "mobile" / "assets" / "fonts" / "FairBillUISans-Semibold.ttf"
    matrix = pymupdf.Matrix(8, 8)
    clip = pymupdf.Rect(44, 44, 56, 58)
    with pymupdf.open() as reference:
        page = reference.new_page(width=595, height=842)
        page.insert_text((46, 55), "₹", fontsize=10.5, fontname="RupeeReference",
                         fontfile=str(expected_font), color=(0.10, 0.20, 0.19))
        expected = page.get_pixmap(matrix=matrix, clip=clip).samples

    with pymupdf.open(stream=resolution.evidence_packet(["₹"]), filetype="pdf") as pdf:
        actual = pdf[0].get_pixmap(matrix=matrix, clip=clip).samples
    assert min(expected) < 255
    assert actual == expected


def test_packet_keeps_wide_currency_lines_inside_the_page():
    line = "W" * 87 + " ₹1.25"
    lines = [line] * 26 + ["Final amount ₹740.00"]
    with pymupdf.open(stream=resolution.evidence_packet(lines), filetype="pdf") as pdf:
        assert len(pdf) == 2
        extracted = "".join(page.get_text() for page in pdf)
        assert extracted.count("W") == 87 * 26
        assert extracted.count("₹1.25") == 26
        assert extracted.rstrip().endswith("Final amount ₹740.00")
        for page in pdf:
            assert all(46 <= left < right <= page.rect.width - 45
                       for left, _, right, *_ in page.get_text("words"))
