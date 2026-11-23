import hashlib
import json
import os
from collections import defaultdict
from datetime import datetime, timezone

import httpx
from pydantic import BaseModel

from .documents import excerpt

CHECKS = ("duplicates", "quantities", "settlement", "patient_report")
LABELS = {
    "duplicates": "Compare repeated hospital charges with distinct service orders",
    "quantities": "Compare invoice quantities with the service record",
    "settlement": "Trace deductions to the insurance policy",
    "patient_report": "Record the patient's services to clarify",
}
DEPENDENCIES = {
    "invoice": {"duplicates", "quantities", "patient_report"},
    "service_record": {"duplicates", "quantities"},
    "settlement": {"settlement"},
    "policy": {"settlement"},
}


class Plan(BaseModel):
    checks: list[str]


class Wording(BaseModel):
    opening: str
    closing: str


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def gemini(schema: type[BaseModel], prompt: str):
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    model = os.getenv("FAIRBILL_GEMINI_MODEL", "gemini-3.8-flash")
    if not model.startswith("gemini-") or not model.replace("-", "").replace(".", "").isalnum():
        return None
    try:
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseJsonSchema": schema.model_json_schema(),
                    "maxOutputTokens": 768,
                },
            },
            timeout=httpx.Timeout(6, connect=2),
        )
        response.raise_for_status()
        return schema.model_validate_json(response.json()["candidates"][0]["content"]["parts"][0]["text"])
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        return None


def eligible_for_model(case: dict) -> bool:
    # Confirming or correcting any document revokes its bundled provenance.
    return case["sample"] and all(doc["bundled"] for doc in case["documents"])


def ref(pair: tuple[dict, dict], relation: str) -> dict:
    doc, row = pair
    return {
        "document_id": doc["id"], "document_kind": doc["kind"], "sha256": doc["sha256"],
        "row_id": row["id"], "page": row["page"], "line": row["line"],
        "quote": excerpt(doc, row), "relation": relation,
        "basis": "patient_confirmed" if row["id"] in doc.get("edited_rows", []) else "document",
    }


def key_for(row: dict) -> tuple[str, str]:
    return row["code"].casefold(), row["service_date"]


def grouped_rows(rows, kind):
    groups = defaultdict(list)
    for pair in rows:
        row = pair[1]
        if row["type"] == kind and all(key_for(row)):
            groups[key_for(row)].append(pair)
    return groups


def finding_id(check: str, pairs: list[tuple[dict, dict]]) -> str:
    key = json.dumps([(doc["id"], row["id"]) for doc, row in pairs])
    return f"{check}-{hashlib.sha256(key.encode()).hexdigest()[:16]}"


def finding(check, pairs, title, explanation, amount, evidence, *, adjustment=False,
            status="active", exposure=None):
    return {
        "id": finding_id(check, pairs), "check": check, "title": title,
        "explanation": explanation, "amount": amount, "status": status,
        "adjustment": adjustment, "exposure": exposure, "evidence": evidence,
    }


def duplicates(rows):
    matches = grouped_rows(rows, "charge")
    orders = grouped_rows(rows, "order")
    findings = []
    for key, charges in matches.items():
        same_charge = defaultdict(list)
        for pair in charges:
            row = pair[1]
            same_charge[(row["description"].casefold(), row["units"], row["amount"])].append(pair)
        order_ids = {}
        conflicting_orders = False
        for doc, row in orders[key]:
            record_id = row["reference"].casefold()
            if record_id in order_ids and order_ids[record_id][1]["units"] != row["units"]:
                conflicting_orders = True
            order_ids.setdefault(record_id, (doc, row))
        for group in same_charge.values():
            if len(group) < 2:
                continue
            explicit_references = {row["reference"].casefold() for _, row in group if row["reference"]}
            if len(explicit_references) == len(group):
                continue
            units_per_line = group[0][1]["units"]
            supported_units = 0 if conflicting_orders or len(same_charge) > 1 else sum(
                row["units"] for _, row in order_ids.values()
            )
            supported_lines = min(len(group), supported_units // units_per_line)
            extra_lines = len(group) - max(1, supported_lines)
            evidence = [ref(pair, "supports") for pair in group]
            evidence += [ref(pair, "contradicts" if index else "context")
                         for index, pair in enumerate(order_ids.values())]
            explanation = (
                "Distinct service orders support the repeated charges."
                if not extra_lines else
                "The invoice repeats this charge. Ask billing to confirm each occurrence against its service order."
            )
            findings.append(finding(
                "duplicates", group, "Possible duplicate charge", explanation,
                extra_lines * group[0][1]["amount"] if extra_lines else None,
                evidence, status="active" if extra_lines else "withdrawn",
                adjustment=bool(extra_lines and not conflicting_orders and len(same_charge) == 1), exposure=list(key),
            ))
    return findings


def quantities(rows):
    findings = []
    charges = grouped_rows(rows, "charge")
    for key, records in grouped_rows(rows, "quantity").items():
        if len(charges[key]) != 1 or len({row["units"] for _, row in records}) != 1:
            continue
        charge = charges[key][0]
        invoice = charge[1]
        documented = records[0][1]["units"]
        if documented >= invoice["units"]:
            continue
        difference = invoice["units"] - documented
        value = None if invoice["unit_price"] is None else difference * invoice["unit_price"]
        findings.append(finding(
            "quantities", [charge], "Quantity needs clarification",
            f"The invoice lists {invoice['units']} units. The supplied service record lists {documented}.",
            value, [ref(charge, "supports"), *(ref(pair, "supports") for pair in records)],
            adjustment=value is not None, exposure=list(key),
        ))
    return findings


def settlement(rows):
    policies = defaultdict(list)
    for pair in rows:
        if pair[1]["type"] == "clause":
            policies[pair[1]["reference"].casefold()].append(pair)
    findings = []
    for pair in rows:
        row = pair[1]
        if row["type"] != "deduction":
            continue
        linked = policies.get(row["reference"].casefold(), [])
        findings.append(finding(
            "settlement", [pair], "Deduction linked to policy" if linked else "Insurance deduction unexplained",
            "The statement references this clause. Its applicability still needs review." if linked else
            "Ask the insurer for an itemised explanation and the applicable policy clause.",
            row["amount"], [ref(pair, "supports"), *(ref(clause, "context") for clause in linked)],
            status="linked" if linked else "active",
        ))
    return findings


def patient_report(rows):
    return [
        finding("patient_report", [pair], "Service reported as not received",
                "The patient marked this service for clarification with the hospital.",
                pair[1]["amount"], [ref(pair, "patient_report")])
        for pair in rows if pair[1]["type"] == "charge" and pair[1]["received"] is False
    ]


TOOLS = dict(zip(CHECKS, (duplicates, quantities, settlement, patient_report), strict=True))


def calculate(rows, findings):
    totals = [row["amount"] for _, row in rows if row["type"] == "invoice_total"]
    charge_rows = [row for _, row in rows if row["type"] == "charge"]
    invoice_count = len({doc["id"] for doc, row in rows if row["type"] in {"charge", "invoice_total"}})
    reconciled = len(totals) == 1 and invoice_count == 1 and bool(charge_rows)
    billed = totals[0] if reconciled else None
    reconciled = billed is not None and billed == sum(row["amount"] for row in charge_rows)
    eligible = [item for item in findings if item["status"] == "active" and item["adjustment"]]
    adjustment = sum(item["amount"] for item in eligible) if reconciled else None
    conditional = billed - adjustment if adjustment is not None else None
    unresolved = [item for item in findings if item["check"] == "settlement" and item["status"] == "active"]
    deductions = [row for _, row in rows if row["type"] == "deduction"]
    return {
        "billed": billed, "reconciled": reconciled, "adjustments": adjustment,
        "conditional": conditional, "unresolved_deduction": sum(item["amount"] for item in unresolved) if deductions else None,
        "included": [item["id"] for item in eligible] if reconciled else [],
    }


def event(state: dict, title: str, detail: str, role: str) -> None:
    state["timeline"].append({
        "id": len(state["timeline"]) + 1, "revision": state["revision"],
        "title": title, "detail": detail, "role": role, "at": now(),
    })


def run(case: dict) -> None:
    before = {item["id"]: item for item in case["findings"]}
    affected = set(case["pending"])
    if not affected and case["investigated_revision"] == case["revision"]:
        return
    options = [check for check in CHECKS if check in affected]
    prior = set(before)
    decision = gemini(
        Plan,
        "Order these distinct allowed checks by investigation value. Return each once. "
        f"Allowed checks: {json.dumps(options)}. "
        f"Confirmed document types: {json.dumps([doc['kind'] for doc in case['documents'] if doc['confirmed']])}. "
        f"Previously active findings: {len(prior)}.",
    ) if options and eligible_for_model(case) else None
    valid_plan = decision and len(decision.checks) == len(options) and set(decision.checks) == set(options)
    plan = decision.checks if valid_plan else options
    case["agent_mode"] = "Gemini" if valid_plan else "Offline"
    event(case, "Investigation planned" if case["investigated_revision"] is None else "Investigation reopened",
          f"{len(plan)} checks selected using {case['agent_mode']}.", "Case investigator")
    rows = [(doc, row) for doc in case["documents"] if doc["confirmed"] for row in doc["rows"]]
    findings = [item for item in before.values() if item["check"] not in affected]
    for check in plan:
        results = TOOLS[check](rows)
        findings.extend(results)
        event(case, LABELS[check], f"{len(results)} findings recorded.",
              "Policy specialist" if check == "settlement" else "Case investigator")
    by_id = {item["id"]: item for item in findings}
    for ident, old in before.items():
        current = by_id.get(ident)
        if old["status"] == "active" and (current is None or current["status"] == "withdrawn"):
            if current is None:
                current = {
                    **old, "status": "withdrawn", "amount": None, "adjustment": False,
                    "explanation": "The current confirmed evidence no longer supports this finding.",
                }
                findings.append(current)
            event(case, f"Finding withdrawn: {old['title']}", current["explanation"], "Adversarial reviewer")
    case["findings"] = findings
    case["scenario"] = calculate(rows, findings)
    case["investigated_revision"] = case["revision"]
    case["pending"] = []
    event(case, "Scenarios verified",
          "Invoice and conditional adjustments reconciled in integer paise." if case["scenario"]["reconciled"]
          else "The confirmed invoice and line totals need reconciliation.", "Scenario planner")
    case["history"].append({
        "revision": case["revision"], "scenario": case["scenario"], "findings": findings, "at": now(),
    })
