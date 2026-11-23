import hashlib
import re
import shutil
import subprocess
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

import pymupdf
from pydantic import BaseModel, ConfigDict, Field, model_validator

Kind = Literal["invoice", "policy", "settlement", "service_record"]
RowKind = Literal["charge", "invoice_total", "deduction", "clause", "order", "quantity"]
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 10
MAX_MONEY = 10**12


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

    @model_validator(mode="after")
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
        if self.type == "charge" and self.unit_price is not None and self.units * self.unit_price != self.amount:
            raise ValueError("The quantity times unit price must equal the line amount.")
        if not self.description:
            raise ValueError("Enter a description.")
        return self


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


def read_rows(pages: list[str], kind: Kind) -> tuple[list[dict], list[str]]:
    rows = []
    notes = []
    seen = set()
    for page, body in enumerate(pages, 1):
        for line, raw in enumerate(body.splitlines(), 1):
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
                row = Row.model_validate(data)
                if row.id in seen:
                    raise ValueError("Duplicate row ID")
                seen.add(row.id)
                rows.append(row.model_dump())
            except (ValueError, IndexError):
                notes.append(f"Page {page}, line {line} needs manual review.")
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


def make_document(doc_id: str, kind: Kind, data: bytes, *, pasted=False, trusted=False) -> dict:
    if pasted:
        if len(data) > 20_000:
            raise ValueError("Paste up to 20,000 bytes at a time.")
        pages = data.decode("utf-8").split("\f")
        if not data.strip() or len(pages) > MAX_PAGES:
            raise ValueError("Paste text for up to 10 pages.")
    else:
        pages = extract(data)
    rows, notes = read_rows(pages, kind)
    return {
        "id": doc_id, "kind": kind, "sha256": hashlib.sha256(data).hexdigest(),
        "pages": pages, "rows": rows, "notes": notes,
        "confirmed": trusted, "bundled": trusted,
    }


def excerpt(doc: dict, row: dict) -> str:
    lines = doc["pages"][row["page"] - 1].splitlines()
    return lines[row["line"] - 1] if 0 < row["line"] <= len(lines) else ""
