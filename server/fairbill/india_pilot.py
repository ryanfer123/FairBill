"""Narrow, source-backed review of patient-confirmed records. Money is in paise."""

import re
from datetime import date, timedelta
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from .documents import excerpt

TARIFF_FROM = date(2026, 11, 1)
TARIFF_VERIFIED_THROUGH = date(2026, 11, 24)
TARIFF = "https://tmc.gov.in/assets/PDF/SoC.pdf#page=1"
BOOKLET = "https://tmc.gov.in/event/upload/12112025_5/TMH_Brochure_%20patient%20booklet.pdf"
POLICY_BASE = "https://www.newindia.co.in/assets/docs/know-more/health/new-india-mediclaim-policy/"
POLICIES = {
    "NIAHLIP25040V082425": POLICY_BASE + "Policy%20Clause%20New%20India%20mediclaim%20%20.pdf",
    "NIAHLIP25040V102425": POLICY_BASE + "PolicyClause_%20NewIndiaMediclaimPolicy.pdf",
}
CATEGORIES = ("NC", "C", "B", "A", "D", "FN")
DAILY_RATES = {
    "B001": dict(zip(CATEGORIES, (50, 420, 4200, 8200, 10000, 8200), strict=True)),
    "B003": dict(zip(CATEGORIES, (90, 840, 4200, 7000, 8200, 7000), strict=True)),
}
DocumentID = Annotated[str, Field(min_length=1, max_length=80)]
Category = Literal["NC", "C", "B", "A", "D", "FN"]


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(strict=True, ge=1)


class TariffInput(ReviewInput):
    review: Literal["tariff"]
    invoice_id: DocumentID
    category: Category
    edition: Literal["tmh-parel-2026-11-01-v6"]
    confirmed_applicability: Literal[True]


class AidInput(ReviewInput):
    review: Literal["aid"]
    invoice_id: DocumentID
    hospital: Literal["tmh-parel"]
    category: Category | Literal["BP", "F"]


class InsuranceInput(ReviewInput):
    review: Literal["insurance"]
    invoice_id: DocumentID
    settlement_id: DocumentID
    policy_id: DocumentID
    uin: Literal["NIAHLIP25040V082425", "NIAHLIP25040V102425"]
    confirmed_applicability: Literal[True]


PilotInput = Annotated[TariffInput | AidInput | InsuranceInput, Field(discriminator="review")]


class RecordLine(BaseModel):
    document_id: str
    page: int
    line: int
    quote: str


class ReferenceFinding(BaseModel):
    title: str
    detail: str
    source_url: str
    citation: str
    record: RecordLine | None = None
    billed_paise: int | None = None
    reference_paise: int | None = None
    difference_paise: int | None = None


class PilotReview(BaseModel):
    revision: int
    findings: list[ReferenceFinding]
    note: str


def confirmed_document(case, ident, kind):
    doc = next((d for d in case["documents"] if d["id"] == ident and d["kind"] == kind), None)
    if doc is None or not doc["confirmed"]:
        raise ValueError(f"Choose a confirmed {kind} document.")
    return doc


def record(doc, row):
    return RecordLine(document_id=doc["id"], page=row["page"], line=row["line"], quote=excerpt(doc, row))


def compare_daily_rates(invoice, category):
    findings = []
    for row in invoice["rows"]:
        code = row["code"].upper()
        if (
            row["type"] != "charge" or code not in DAILY_RATES
            or not row["service_date"]
            or row["units"] is None or row["amount"] is None or row["received"] is False
            or (row["unit_price"] is not None and row["amount"] != row["units"] * row["unit_price"])
        ):
            continue
        start = date.fromisoformat(row["service_date"])
        days = row["units"]
        if not TARIFF_FROM <= start <= TARIFF_VERIFIED_THROUGH or days > (TARIFF_VERIFIED_THROUGH - start + timedelta(days=1)).days:
            continue
        unit_paise = DAILY_RATES[code][category] * 100
        expected = unit_paise * row["units"]
        delta = row["amount"] - expected
        findings.append(ReferenceFinding(
            title=f"{code} · Published daily rate",
            detail=f"Category {category}, {row['units']} billed day(s) at ₹{unit_paise // 100:,} per day. "
                   "Ask billing to explain any difference before requesting an adjustment.",
            source_url=TARIFF, citation=f"Tata Memorial Centre, Parel · 2024–27 v6 · p. 1 · {code} · {category}",
            record=record(invoice, row), billed_paise=row["amount"], reference_paise=expected,
            difference_paise=delta,
        ))
    return findings


def insurance_guidance(settlement, uin):
    return [
        ReferenceFinding(
            title="Ask how the room-related deduction was calculated",
            detail="Clause 3.2 limits proportionate deductions to qualifying associated medical expenses. "
                   "Ask which lines had differential room-category billing and whether excluded diagnostics, "
                   "devices, pharmacy or consumables were included in the calculation.",
            source_url=POLICIES[uin], citation=f"New India Mediclaim · {uin} · clause 3.2",
            record=record(settlement, row),
        )
        for row in settlement["rows"]
        if row["type"] == "deduction"
        and re.search(r"\b(?:proportionate|proportional|room\s+rent)\b", row["description"], re.IGNORECASE)
    ]


def review_case(case, data: PilotInput):
    invoice = confirmed_document(case, data.invoice_id, "invoice")
    if isinstance(data, TariffInput):
        findings = compare_daily_rates(invoice, data.category)
        note = ("Published-rate comparisons cover B001 and B003 for supported dates. "
                "Confirm the total number of days falls within that edition. Differences are questions for billing.")
        if not findings:
            note = "No confirmed B001 or B003 daily charge matched the supported 1–24 November 2026 dates."
    elif isinstance(data, AidInput):
        guidance = {
            "NC": "Ask the hospital whether the NC category was applied to this bill.",
            "C": "If subsidised charges are still unaffordable, ask Medical Social Work about an NC means assessment.",
            "BP": "Ask the hospital scheme desk which treatment is covered and how the scheme appears on the bill.",
        }
        findings = [ReferenceFinding(
            title="Ask about hospital financial assistance",
            detail=guidance.get(data.category, "Ask Medical Social Work which support options apply to your category."),
            source_url=BOOKLET, citation="Tata Memorial Hospital patient booklet · section 14.2",
        )]
        note = "The hospital determines the category after reviewing the patient's circumstances."
    else:
        policy = confirmed_document(case, data.policy_id, "policy")
        if not any(re.search(rf"\b{data.uin}\b", page, re.IGNORECASE) for page in policy["pages"]):
            raise ValueError("The confirmed policy must show the supported UIN.")
        settlement = confirmed_document(case, data.settlement_id, "settlement")
        findings = insurance_guidance(settlement, data.uin)
        note = ("This review identifies questions for the insurer. Check the issued schedule and endorsements "
                "before interpreting the policy. If no questions appear, check how the insurer described each deduction.")
    return PilotReview(revision=case["revision"], findings=findings, note=note)
