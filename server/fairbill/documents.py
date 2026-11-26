import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Literal

import pymupdf
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .document_media import (
    MAX_PAGE_CHARS, extract_image_lines, extract_versioned, media_type as sniff_media_type, validated_image,
)

Kind = Literal["invoice", "policy", "settlement", "service_record"]
RowKind = Literal["charge", "invoice_total", "deduction", "clause", "order", "quantity"]
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 10
MAX_MONEY = 10**12
MAX_DEVICE_OCR_LINES = 600


class Row(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    type: RowKind
    page: int = Field(ge=1, le=MAX_PAGES)
    line: int = Field(ge=1, le=9999)
    description: str = Field(max_length=250)
    code: str = Field(default="", max_length=60)
    service_date: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    reference: str = Field(default="", max_length=80)
    units: int | None = Field(default=None, ge=1, le=9999, strict=True)
    amount: int | None = Field(default=None, ge=0, le=MAX_MONEY, strict=True)
    unit_price: int | None = Field(default=None, ge=0, le=MAX_MONEY, strict=True)
    received: bool | None = None

    def check_required_fields(self):
        if self.service_date:
            date.fromisoformat(self.service_date)
        if self.type in {"charge", "invoice_total", "deduction"} and self.amount is None:
            raise ValueError("Enter an amount in paise.")
        if self.type in {"charge", "order", "quantity"} and self.units is None:
            raise ValueError("Enter a quantity.")
        if self.type == "clause" and not self.reference:
            raise ValueError("Enter a policy clause ID.")
        if self.type in {"order", "quantity"} and not all((self.code, self.service_date, self.reference)):
            raise ValueError("Enter the service code, date and record ID.")
        if not self.description:
            raise ValueError("Enter a description.")
        return self

    @model_validator(mode="after")
    def validate_record(self):
        self.check_required_fields()
        if self.type == "charge" and self.unit_price is not None and self.units * self.unit_price != self.amount:
            raise ValueError("The quantity times unit price must equal the line amount.")
        return self


class ObservedRow(Row):
    """Preserve a source's recorded amount so the arithmetic rule can check it."""

    @model_validator(mode="after")
    def validate_record(self):
        return self.check_required_fields()


ROW_TYPES = {
    "invoice": {"charge", "invoice_total"},
    "policy": {"clause"},
    "settlement": {"deduction"},
    "service_record": {"order", "quantity"},
}
LABELS = {
    "CHARGE": "charge", "TOTAL": "invoice_total", "DEDUCTION": "deduction",
    "CLAUSE": "clause", "ORDER": "order", "QUANTITY": "quantity",
}

RUPEE_MARK = r"(?:₹|INR\b|Rs\.?(?![A-Za-z]))"
NUMBER = r"(?:[0-9]{1,11}|[0-9]{1,3}(?:,[0-9]{3}){1,3}|[0-9]{1,2}(?:,[0-9]{2}){1,4},[0-9]{3})(?:\.[0-9]{1,2})?"
RUPEE_AMOUNT = rf"(?:{RUPEE_MARK}\s*)?{NUMBER}"
COLUMN_CURRENCY = rf"(?:\s*\(\s*{RUPEE_MARK}\s*\)|\s+{RUPEE_MARK})"
ITEM_HEADER = re.compile(
    rf"(?:(?P<serial>s\.?\s*no\.?|sr\.?\s*no\.?|#)\s+)?"
    rf"(?:(?:item|service)\s+)?description\s+(?:[qo]ty\.?|quantity)\s+"
    rf"(?:rate|unit\s+(?:price|rate))(?P<rate_currency>{COLUMN_CURRENCY})?\s+"
    rf"(?:line\s+)?amount(?P<amount_currency>{COLUMN_CURRENCY})?", re.IGNORECASE,
)
ITEM_ROW = re.compile(
    rf"(?P<description>.+?)\s+(?P<quantity>[0-9]{{1,4}})\s+(?P<rate>{RUPEE_AMOUNT})\s+(?P<amount>{RUPEE_AMOUNT})",
    re.IGNORECASE,
)
INVOICE_TOTAL = re.compile(
    rf"(?P<label>(?:(?:grand|invoice|bill)\s+)?total)(?:\s*:\s*|\s+)(?P<amount>{RUPEE_AMOUNT})", re.IGNORECASE,
)
SUMMARY = re.compile(
    r"(?:sub\s?total\b|(?:grand|invoice|bill)\s+total\b|(?:[ics]?gst|vat|tax)\b|"
    r"discount\b|round[ -]?off|(?:net|balance|amount)\s+(?:due|payable)|(?:advance|payment)\s+(?:received|paid)|"
    r"(?:payment|insurance|tax)\s+details\b)",
    re.IGNORECASE,
)
COLUMNS = {
    "#": "serial", "s no": "serial", "sno": "serial", "sr no": "serial", "sl no": "serial", "serial no": "serial",
    "description": "description", "item description": "description", "service description": "description",
    "qty": "quantity", "oty": "quantity", "quantity": "quantity", "units": "quantity",
    "rate": "rate", "unit rate": "rate", "unit price": "rate", "price per unit": "rate",
    "amount": "amount", "line amount": "amount", "line total": "amount",
    "service date": "service_date", "date of service": "service_date", "service code": "code",
    "order id": "reference", "order no": "reference", "service reference": "reference",
}
ITEM_COLUMNS = ("description", "quantity", "rate", "amount")
CELL_CURRENCY = re.compile(rf"(?P<label>.+?)(?P<currency>{COLUMN_CURRENCY})?", re.IGNORECASE)
QUANTITY = re.compile(r"[0-9]{1,4}")
CURRENCY_LINE = re.compile(r"\s*(?:invoice\s+)?currency\s*:\s*(?P<currency>\S.*?)\s*", re.IGNORECASE)


def paise(raw: str) -> int | None:
    raw = raw.strip().replace(",", "").removeprefix("₹").removeprefix("INR").strip()
    if not raw:
        return None
    if not re.fullmatch(r"[0-9]{1,11}(\.[0-9]{1,2})?", raw):
        raise ValueError("Use a rupee amount with at most two decimal places.")
    try:
        cents = Decimal(raw) * 100
        if cents.is_finite() and cents == cents.to_integral_value() and 0 <= cents <= MAX_MONEY:
            return int(cents)
    except InvalidOperation:
        pass
    raise ValueError("Use a rupee amount with at most two decimal places.")


def invoice_money(raw: str, currency_stated: bool) -> int:
    prefix = re.match(RUPEE_MARK, raw, re.IGNORECASE)
    if not currency_stated and prefix is None:
        raise ValueError("Missing rupee currency")
    if not re.fullmatch(RUPEE_AMOUNT, raw, re.IGNORECASE):
        raise ValueError("Invalid rupee amount")
    amount = paise(raw[prefix.end():] if prefix else raw)
    if amount is None:
        raise ValueError("Missing amount")
    return amount


def invoice_cells(raw: str) -> list[str]:
    if re.search(r"[|｜│¦]", raw):
        cells = re.split(r"[|｜│¦]", raw.strip().strip("|｜│¦"))
    else:
        cells = re.split(r"\t| {2,}", raw.strip(" "))
    return [" ".join(cell.split()) for cell in cells]


def invoice_header(cells: list[str], text: str) -> dict[str, bool]:
    if len(cells) > 1:
        columns = {}
        for cell in cells:
            label = CELL_CURRENCY.fullmatch(cell)
            if label is None:
                return {}
            field = COLUMNS.get(label["label"].lower().replace(".", ""))
            if not field or field in columns or (label["currency"] and field not in {"rate", "amount"}):
                return {}
            columns[field] = bool(label["currency"])
        return columns if all(name in columns for name in ITEM_COLUMNS) else {}
    header = ITEM_HEADER.fullmatch(text)
    if not header:
        return {}
    columns = {"serial": False} if header["serial"] else {}
    columns.update(description=False, quantity=False, rate=bool(header["rate_currency"]),
                   amount=bool(header["amount_currency"]))
    return columns


def invoice_item(cells: list[str], text: str, header: dict[str, bool], page_currency: bool) -> dict | None:
    if len(cells) > 1:
        if len(cells) != len(header) or not all(cells):
            raise ValueError("Missing invoice table cell")
        fields = dict(zip(header, cells, strict=True))
    else:
        expected = ("serial", *ITEM_COLUMNS) if "serial" in header else ITEM_COLUMNS
        row = ITEM_ROW.fullmatch(text) if tuple(header) == expected else None
        if row is None:
            return None
        fields = row.groupdict()
        if "serial" in header:
            fields["serial"], _, fields["description"] = fields["description"].partition(" ")
    if "serial" in fields and not re.fullmatch(r"[0-9]+\.?", fields["serial"]):
        raise ValueError("Invalid item number")
    if not QUANTITY.fullmatch(fields["quantity"]):
        raise ValueError("Invalid item quantity")
    optional = {name: fields[name] for name in ("service_date", "code", "reference") if name in fields}
    return dict(
        type="charge", description=fields["description"], units=int(fields["quantity"]),
        unit_price=invoice_money(fields["rate"], page_currency or header["rate"]),
        amount=invoice_money(fields["amount"], page_currency or header["amount"]), **optional,
    )


def observed_invoice_rows(pages: list[str]) -> tuple[list[dict], list[str]]:
    rows = []
    totals = []
    notes = []
    for page, body in enumerate(pages, 1):
        lines = body.splitlines()
        currencies = [match["currency"] for raw in lines if (match := CURRENCY_LINE.fullmatch(raw))]
        if any(not re.fullmatch(RUPEE_MARK, currency, re.IGNORECASE) for currency in currencies):
            notes.append(f"Page {page} has a non-rupee or ambiguous currency label. Review the source before adding amounts.")
            continue
        page_currency = bool(currencies)
        header = {}
        summary = False
        for line, raw in enumerate(lines, 1):
            cells = invoice_cells(raw)
            text = " ".join(cell for cell in cells if cell)
            if not text:
                continue
            current_header = invoice_header(cells, text)
            if current_header:
                header = current_header
                summary = False
                continue
            total = INVOICE_TOTAL.fullmatch(text)
            if not header and not (total and rows):
                continue
            location = {"id": f"p{page}-l{line}", "page": page, "line": line}
            try:
                if header and len(cells) == len(header):
                    summary_text = cells[list(header).index("description")]
                else:
                    summary_text = re.sub(r"^[0-9]+\.?\s+", "", text) if "serial" in header else text
                if total or SUMMARY.match(summary_text):
                    summary = True
                    if total and rows:
                        total_currency = page_currency or header.get("amount", False)
                        row = ObservedRow(**location, type="invoice_total", description=total["label"],
                                          amount=invoice_money(total["amount"], total_currency))
                        totals.append(row.model_dump())
                elif not summary and not CURRENCY_LINE.fullmatch(text):
                    item = invoice_item(cells, text, header, page_currency)
                    if item:
                        rows.append(ObservedRow(**location, **item).model_dump())
            except ValueError:
                notes.append(f"Page {page}, line {line} needs manual review.")
    if len(totals) == 1:
        rows.extend(totals)
    elif totals:
        notes.append("More than one invoice total was found. Choose the correct total during review.")
    return sorted(rows, key=lambda row: (row["page"], row["line"])), notes


def read_rows(pages: list[str], kind: Kind, *, observed: bool = False) -> tuple[list[dict], list[str]]:
    rows = []
    notes = []
    seen = set()
    for page, body in enumerate(pages, 1):
        for line, raw in enumerate(body.splitlines(), 1):
            if observed:
                separator = r"[|｜│¦]" if re.search(r"[|｜│¦]", raw) else r"\t"
                cells = [cell.strip() for cell in re.split(separator, raw.strip(" |｜│¦"))]
            else:
                cells = [cell.strip() for cell in raw.split("|")]
            row_type = LABELS.get(cells[0].upper())
            if row_type not in ROW_TYPES[kind]:
                continue
            try:
                if len(cells) < 4:
                    raise ValueError("Missing fields")
                _, row_id, desc, *parts = cells
                data = dict(id=row_id, type=row_type, page=page, line=line, description=desc)
                if row_type == "charge":
                    code, service_date, units, unit_price, amount, *optional = parts
                    data.update(code=code, service_date=service_date, units=int(units),
                                unit_price=paise(unit_price), amount=paise(amount),
                                reference=optional[0] if optional else "")
                elif row_type == "invoice_total":
                    data.update(amount=paise(parts[0]))
                elif row_type == "clause":
                    data.update(reference=parts[0])
                elif row_type == "deduction":
                    data.update(amount=paise(parts[0]), reference=parts[1] if len(parts) > 1 else "")
                else:
                    code, service_date, units, reference = parts
                    data.update(code=code, service_date=service_date, units=int(units), reference=reference)
                row_class = ObservedRow if observed else Row
                row = row_class.model_validate(data)
                if row.id in seen:
                    raise ValueError("Duplicate row ID")
                seen.add(row.id)
                rows.append(row.model_dump())
            except (ValueError, IndexError):
                notes.append(f"Page {page}, line {line} needs manual review.")
    if not rows and observed and kind == "invoice":
        rows, table_notes = observed_invoice_rows(pages)
        notes.extend(table_notes)
    if not rows:
        notes.append("Add rows manually using the extracted text.")
    return rows, notes


def ocr(data: bytes) -> str:
    if not shutil.which("tesseract"):
        raise ValueError("Local OCR is unavailable. Install Tesseract or paste the document text.")
    try:
        result = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "6"],
            input=data, capture_output=True, timeout=15, check=True,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ValueError("The image could not be read. Retake it or paste the text.") from exc
    return result.stdout.decode("utf-8", errors="replace")


def extract(data: bytes) -> list[str]:
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Choose a document up to 10 MB.")
    if data.startswith(b"%PDF-"):
        try:
            with pymupdf.open(stream=data, filetype="pdf") as pdf:
                if pdf.is_encrypted or not 1 <= len(pdf) <= MAX_PAGES:
                    raise ValueError("Use an unlocked PDF of up to 10 pages.")
                if sum(abs(page.rect.width * page.rect.height) for page in pdf) > 10_000_000:
                    raise ValueError("PDF page dimensions are too large.")
                pages = []
                scanned_count = 0
                for page in pdf:
                    page_text = page.get_text().strip()
                    if not page_text:
                        scanned_count += 1
                        if scanned_count > 3:
                            raise ValueError("Import up to three scanned pages at a time.")
                        page_text = ocr(page.get_pixmap(dpi=160).tobytes("png"))
                    pages.append(page_text[:16000])
                return pages
        except (RuntimeError, pymupdf.FileDataError) as exc:
            raise ValueError("The PDF could not be read.") from exc
    if data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")):
        return [ocr(data)[:16000]]
    raise ValueError("Choose a PDF, JPEG or PNG, or paste the text.")


def extracted_pages(extracted: list[list[dict]]) -> list[str]:
    return ["\n".join(line["raw_text"] for line in page) for page in extracted]


def invoice_coverage(rows: list[dict]) -> tuple[bool, int]:
    charges = [row["amount"] for row in rows if row["type"] == "charge"]
    totals = [row["amount"] for row in rows if row["type"] == "invoice_total"]
    return bool(charges) and totals == [sum(charges)], len(rows)


def device_assisted_invoice(data: bytes, mime: str, lines: list[str]) -> tuple[list[list[dict]], list[dict], list[str]]:
    image = validated_image(data, mime)
    records = [{"raw_text": line, "source": "device_ocr", "bbox": None, "confidence": None}
               for line in lines]
    device = [records]
    rows, notes = read_rows(extracted_pages(device), "invoice", observed=True)
    device_coverage = invoice_coverage(rows)
    if not device_coverage[0] or notes:
        try:
            hosted = [extract_image_lines(image)]
        except ValueError:
            if not rows:
                raise
        else:
            hosted_rows, hosted_notes = read_rows(extracted_pages(hosted), "invoice", observed=True)
            if invoice_coverage(hosted_rows) >= device_coverage:
                return hosted, hosted_rows, hosted_notes
    return device, rows, ["Text extracted on your device. Compare each row with the original invoice.", *notes]


def make_document(
    doc_id: str, kind: Kind, data: bytes, *, pasted=False, trusted=False,
    versioned: bool = False, media_type: str | None = None, device_ocr_text: str | None = None,
) -> dict:
    extracted = None
    parsed = None
    if pasted:
        if len(data) > 20_000:
            raise ValueError("Paste up to 20,000 bytes at a time.")
        pages = data.decode("utf-8").split("\f")
        if not data.strip() or len(pages) > MAX_PAGES:
            raise ValueError("Paste text for up to 10 pages.")
        mime = "text/plain"
        if versioned:
            extracted = [[{
                "raw_text": line, "source": "paste", "bbox": None, "confidence": None,
            } for line in page.splitlines()] for page in pages]
    elif versioned:
        if not data or len(data) > MAX_BYTES:
            raise ValueError("Choose a document up to 10 MB.")
        mime = sniff_media_type(data)
        if media_type and media_type.split(";")[0].strip().lower() not in {mime, "application/octet-stream"}:
            raise ValueError("The file contents do not match the declared media type.")
        device_lines = []
        if (kind == "invoice" and mime in {"image/jpeg", "image/png"} and device_ocr_text
                and len(device_ocr_text) <= MAX_PAGE_CHARS and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", device_ocr_text)):
            device_lines = [line for line in device_ocr_text.splitlines() if line.strip()]
        if 0 < len(device_lines) <= MAX_DEVICE_OCR_LINES:
            extracted, rows, notes = device_assisted_invoice(data, mime, device_lines)
            parsed = rows, notes
            trusted = False
        else:
            extracted = extract_versioned(data, mime, MAX_PAGES)
        pages = extracted_pages(extracted)
    else:
        pages = extract(data)
    rows, notes = parsed if parsed is not None else read_rows(pages, kind, observed=versioned)
    document = {
        "id": doc_id, "kind": kind, "sha256": hashlib.sha256(data).hexdigest(),
        "pages": pages, "rows": rows, "notes": notes,
        "confirmed": trusted, "bundled": trusted,
    }
    if extracted is not None:
        parsed = {(row["page"], row["line"]) for row in rows}
        document.update(media_type=mime, extracted_lines=[
            {**record, "id": f"p{page}-l{line}", "page": page, "line": line,
             "needs_manual_entry": bool(record["raw_text"].strip()) and (page, line) not in parsed}
            for page, records in enumerate(extracted, 1)
            for line, record in enumerate(records, 1)
        ])
    return document


def _original_path(owner_id: str, case_id: str, document: dict) -> Path:
    ids = (owner_id, case_id, document["id"])
    if not all(re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value) for value in ids):
        raise ValueError("Invalid document storage identifier.")
    database = Path(os.getenv("FAIRBILL_DB", "../.local/fairbill.sqlite3"))
    root = Path(os.getenv("FAIRBILL_DOCUMENT_STORE", str(database.parent / "originals")))
    return root.joinpath(*ids)


def store_original(owner_id: str, case_id: str, document: dict, data: bytes) -> None:
    if hashlib.sha256(data).hexdigest() != document["sha256"]:
        raise ValueError("The original file does not match the document hash.")
    target = _original_path(owner_id, case_id, document)
    target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as temporary:
        staging = Path(temporary.name)
        try:
            temporary.write(data)
            temporary.flush()
            os.fsync(temporary.fileno())
            os.replace(staging, target)
        finally:
            staging.unlink(missing_ok=True)


def remove_original(owner_id: str, case_id: str, document: dict) -> None:
    _original_path(owner_id, case_id, document).unlink(missing_ok=True)


def excerpt(doc: dict, row: dict) -> str:
    lines = doc["pages"][row["page"] - 1].splitlines()
    return lines[row["line"] - 1] if 0 < row["line"] <= len(lines) else ""
