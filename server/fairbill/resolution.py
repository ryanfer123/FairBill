import hashlib
import textwrap
from typing import Literal

import pymupdf

from .investigation import Wording, eligible_for_model, event, gemini

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
        }[item["check"]]
        points.append(f"{label}{value}. {ask}")
    return points


def make_draft(case: dict, action: Action) -> dict:
    points = approved_points(case)
    if not points:
        points = ["Please provide an itemised bill and the available billing records."]
    if action == "letter":
        choice = gemini(
            Wording,
            "Choose an opening and closing by copying exactly one sentence from each list. "
            "The message will request clarification about hospital billing. "
            f"Openings: {OPENINGS}. Closings: {CLOSINGS}.",
        ) if eligible_for_model(case) else None
        valid = choice and choice.opening in OPENINGS and choice.closing in CLOSINGS
        opening, closing = (choice.opening, choice.closing) if valid else (OPENINGS[0], CLOSINGS[0])
        text = "\n\n".join(("Dear billing or claims team,", opening, *points, closing, "Thank you."))
        mode = "Gemini" if valid else "Offline"
    else:
        text = "\n\n".join((
            "I am FairBill, a virtual billing advocate. The patient is on the line.",
            "I will wait while the patient completes identity verification.",
            *points,
            "Could you place a hold while you review the account and provide the itemised bill, supporting records and a reference number?",
        ))
        mode = "Offline"
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    draft = {"action": action, "revision": case["revision"], "hash": digest, "text": text, "mode": mode}
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
