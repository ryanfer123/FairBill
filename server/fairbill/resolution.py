import hashlib
import os
import textwrap
from collections.abc import Iterable
from typing import Literal

import pymupdf

from .claims import validate_claims
from .investigation import Wording, eligible_for_model, event, gemini
from .redaction import RedactionError, assert_no_private_values, known_values, redact_text

Action = Literal["letter", "call"]
OPENINGS = ("Please review the following items on my hospital bill and settlement statement.",
            "I am requesting clarification about the following items.")
CLOSINGS = ("Please send a written response with any supporting records.",
            "Thank you for reviewing these questions.")


def money(amount: int) -> str:
    whole, fraction = divmod(amount, 100)
    return f"INR {whole:,}.{fraction:02d}"


def approved_points(case):
    points = []
    for item in case["findings"]:
        if item["status"] != "active":
            continue
        label = item["title"]
        amount = item["amount"]
        value = f" ({money(amount)})" if amount is not None else ""
        ask = {
            "duplicates": "Please confirm the repeated entries against their service orders.",
            "quantities": "Please reconcile the billed and documented quantities.",
            "settlement": "Please explain the deduction and identify the policy clause.",
            "patient_report": "Please confirm the service against the treatment record.",
            "unit_limit": "Please confirm the documented units for this service.",
            "line_arithmetic": "Please explain how the line amount was calculated.",
            "invoice_arithmetic": "Please reconcile the itemised charges with the invoice total.",
            "reference_tariff": "Please explain the difference from the cited fictional reference tariff.",
        }.get(item["check"], "Please clarify this item using the linked supporting records.")
        points.append(f"{label}{value}. {ask}")
    return points


def make_draft(case: dict, action: Action, *, allow_model: bool = True, patient_call: bool = False) -> dict:
    points = approved_points(case)
    if not points:
        points = ["Please provide an itemised bill and the available billing records."]
    fallback_reason = None
    if action == "letter":
        model_allowed = allow_model and eligible_for_model(case)
        choice = gemini(
            Wording,
            "Choose an opening and closing by copying exactly one sentence from each list. "
            "The message will request clarification about hospital billing. "
            f"Openings: {OPENINGS}. Closings: {CLOSINGS}.",
        ) if model_allowed else None
        text = "\n\n".join(("Dear billing or claims team,", OPENINGS[0], *points, CLOSINGS[0], "Thank you."))
        mode = "Offline"
        if choice:
            candidate = "\n\n".join(("Dear billing or claims team,", choice.opening, *points, choice.closing, "Thank you."))
            if validate_claims(candidate, case):
                fallback_reason = "unsupported_claim"
            elif choice.opening in OPENINGS and choice.closing in CLOSINGS:
                text, mode = candidate, "Gemini"
            else:
                fallback_reason = "unverified_model_wording"
        elif model_allowed and os.environ.get("GEMINI_API_KEY"):
            fallback_reason = "model_unavailable"
    else:
        introduction = (
            "I'm calling about my hospital bill. I can verify my identity if needed.",
        ) if patient_call else (
            "I am FairBill, a virtual billing advocate. The patient is on the line.",
            "I will wait while the patient completes identity verification.",
        )
        text = "\n\n".join((
            *introduction, *points,
            "Could you place a hold while you review the account and provide the itemised bill, supporting records and a reference number?",
        ))
        mode = "Offline"
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    draft = {"action": action, "revision": case["revision"], "hash": digest, "text": text, "mode": mode}
    if fallback_reason:
        draft["fallback_reason"] = fallback_reason
        event(case, "Draft used the offline template", fallback_reason, "Resolution strategist")
    case["drafts"][action] = draft
    event(case, f"{action.title()} prepared", f"Exact wording ready for review. Draft mode: {mode}.",
          "Resolution strategist")
    return draft


def packet_lines(case: dict) -> list[str]:
    scenario = case["scenario"]
    lines = ["FairBill  /  Redacted evidence packet", f"Synthetic demo  |  Case revision {case['revision']}", ""]
    for key, title in (
        ("billed", "Original invoice"), ("adjustments", "Conditional adjustments"),
        ("conditional", "Conditional invoice"), ("unresolved_deduction", "Unresolved insurer deduction"),
    ):
        value = scenario[key]
        lines.append(f"{title}: {money(value) if value is not None else 'Unavailable'}")
    lines += ["", "Amounts are conditional. Insurance deductions are shown separately.", "", "Evidence review", ""]
    bundled_sources = {doc["sha256"] for doc in case["documents"] if doc["bundled"]}
    for item in case["findings"]:
        value = f"  |  {money(item['amount'])}" if item["amount"] is not None else ""
        lines.append(f"{item['title']}  |  {item['status'].title()}{value}")
        lines.append(item["explanation"])
        for ref in item["evidence"]:
            label = ref["document_kind"].replace("_", " ").title()
            lines.append(f"  {label}: page {ref['page']}, line {ref['line']}  |  {ref['relation'].replace('_', ' ')}")
            if ref["sha256"] in bundled_sources and ref["basis"] == "document" and ref["quote"]:
                lines.append(f"  {ref['quote']}")
        lines.append("")
    lines += ["Revision history"]
    for entry in case["history"]:
        total = entry["scenario"]["conditional"]
        lines.append(f"Revision {entry['revision']}: {money(total) if total is not None else 'Unavailable'}")
    return lines


def evidence_packet(lines: list[str]) -> bytes:
    with pymupdf.open() as pdf:
        page = None
        y = 0
        for line in lines:
            for part in textwrap.wrap(line, width=93) or [""]:
                if page is None or y > 782:
                    page = pdf.new_page(width=595, height=842)
                    y = 55
                title = line.startswith("FairBill  /")
                page.insert_text((46, y), part, fontsize=18 if title else 10.5,
                                 fontname="hebo" if title else "helv", color=(0.10, 0.20, 0.19))
                y += 28 if title else 16
        return pdf.tobytes(garbage=4, deflate=True)


def _approved_packet_letter(case: dict, candidate: dict | None) -> str | None:
    approval = case.get("approvals", {}).get("letter")
    if not approval:
        return None
    if candidate is None:
        candidate = case.get("drafts", {}).get("letter")
    if not candidate or approval.get("hash") != candidate.get("hash"):
        return None
    text = candidate.get("text")
    digest = candidate.get("hash")
    if not isinstance(text, str) or not isinstance(digest, str) or candidate.get("revision") != case["revision"]:
        return None
    return text if hashlib.sha256(text.encode()).hexdigest() == digest else None


def redacted_packet(
    case: dict, *, approved_letter: dict | None = None, known_pii: Iterable[str] = (), live_case: bool = False,
) -> tuple[list[str], bytes]:
    lines = packet_lines(case)
    revision = f"Case revision {case['revision']}"
    lines[1] = revision if live_case else f"Synthetic demo | Simulated outreach only | {revision}"
    # Patient-edited prose can contain names and addresses outside the patterns we recognize.
    letter = None if live_case else _approved_packet_letter(case, approved_letter)
    if letter:
        lines.extend(("", "Approved letter | Simulation only", *letter.splitlines()))
    private = known_values(case, known_pii, letter=letter)
    clean = [redact_text(line, private) for line in lines]
    assert_no_private_values("\n".join(clean), private)
    packet = evidence_packet(clean)
    with pymupdf.open(stream=packet, filetype="pdf") as pdf:
        output_text = "\n".join(page.get_text() for page in pdf)
    assert_no_private_values(output_text, private)
    return clean, packet
