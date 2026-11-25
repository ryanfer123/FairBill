"""Evidence-led billing questions for the V1 API."""

import json
from collections import defaultdict
from copy import deepcopy

from .investigation import (
    Plan, calculate, duplicates, eligible_for_model, event, finding, gemini,
    grouped_rows, now, patient_report, quantities, ref, settlement,
)
from .reference_data import citation, load_fictional


def invoice_arithmetic(rows, loaded):
    totals = [pair for pair in rows if pair[1]["type"] == "invoice_total"]
    lines = [pair for pair in rows if pair[1]["type"] == "charge"]
    if not lines or len(totals) != 1:
        return []
    total = totals[0]
    if total[1]["amount"] == sum(row["amount"] for _, row in lines):
        return []
    return [finding(
        "invoice_arithmetic", [total], "Invoice total needs reconciliation",
        "Ask billing to reconcile the stated invoice total with its itemised charges.", None,
        [ref(total, "supports"), *(ref(pair, "context") for pair in lines)],
    )]


def line_arithmetic(rows, loaded):
    return [
        finding(
            "line_arithmetic", [pair], "Line amount needs reconciliation",
            "Ask billing to confirm how the listed unit price and quantity produce this line amount.",
            None, [ref(pair, "supports")],
        )
        for pair in rows
        for row in [pair[1]]
        if row["type"] == "charge" and row["unit_price"] is not None
        and row["units"] * row["unit_price"] != row["amount"]
    ]


def duplicate_questions(rows, loaded):
    findings = duplicates(rows)
    covered = {(source["document_id"], source["row_id"]) for item in findings for source in item["evidence"]
               if source["document_kind"] == "invoice"}
    for key, charges in grouped_rows(rows, "charge").items():
        references = defaultdict(list)
        for pair in charges:
            row = pair[1]
            if row["reference"] and (pair[0]["id"], row["id"]) not in covered:
                references[row["reference"].casefold()].append(pair)
        for group in references.values():
            if len(group) < 2:
                continue
            amounts = {row["amount"] for _, row in group}
            impact = (len(group) - 1) * next(iter(amounts)) if len(amounts) == 1 else None
            findings.append(finding(
                "duplicates", group, "Possible duplicate charge",
                "These entries share a service code, date and order. Ask billing to confirm each entry.",
                impact, [ref(pair, "supports") for pair in group],
                adjustment=impact is not None, exposure=list(key),
            ))
    return findings


def unit_limit(rows, loaded):
    limits = loaded[0]["unit_limits"]
    findings = []
    for key, group in grouped_rows(rows, "charge").items():
        code = key[0].upper()
        if code not in limits:
            continue
        limit = limits[code]
        if type(limit) is not int or limit <= 0:
            raise ValueError("Fictional quantity limits must be positive integers.")
        excess = sum(row["units"] for _, row in group) - limit
        if excess <= 0:
            continue
        prices = {row["unit_price"] for _, row in group}
        valid_price = len(prices) == 1 and None not in prices and all(
            row["units"] * row["unit_price"] == row["amount"] for _, row in group
        )
        impact = excess * next(iter(prices)) if valid_price else None
        findings.append(finding(
            "unit_limit", group, "Daily quantity needs clarification",
            "The total units for this date exceed the fictional reference limit. Ask billing to check the service records.",
            impact, [*(ref(pair, "supports") for pair in group), citation(loaded, code, section="unit_limits")],
            adjustment=impact is not None, exposure=list(key),
        ))
    return findings


def reference_tariff(rows, loaded):
    tariffs = loaded[0]["tariffs_paise"]
    findings = []
    for pair in rows:
        row = pair[1]
        code = row["code"].upper()
        if row["type"] != "charge" or row["unit_price"] is None or code not in tariffs:
            continue
        tariff = tariffs[code]
        if type(tariff) is not int or tariff < 0:
            raise ValueError("Fictional tariffs must be nonnegative integer paise.")
        if row["unit_price"] <= tariff:
            continue
        valid_price = row["units"] * row["unit_price"] == row["amount"]
        impact = (row["unit_price"] - tariff) * row["units"] if valid_price else None
        findings.append(finding(
            "reference_tariff", [pair], "Unit price needs clarification",
            "The listed unit price exceeds a fictional reference tariff. Ask billing to clarify the rate.",
            impact, [ref(pair, "supports"), citation(loaded, code, section="tariffs_paise")],
            adjustment=impact is not None, exposure=list((code.casefold(), row["service_date"])),
        ))
    return findings


def settlement_questions(rows, loaded):
    findings = settlement(rows)
    for item in findings:
        if item["status"] == "linked":
            item["explanation"] = "The statement references a clause that still needs applicability review."
    return findings


def documented_quantities(rows, loaded):
    return quantities(rows)


def reported_services(rows, loaded):
    return patient_report(rows)


RULES = {
    "duplicates": duplicate_questions,
    "quantities": documented_quantities,
    "unit_limit": unit_limit,
    "line_arithmetic": line_arithmetic,
    "invoice_arithmetic": invoice_arithmetic,
    "settlement": settlement_questions,
    "reference_tariff": reference_tariff,
    "patient_report": reported_services,
}


def _unique(refs):
    selected = {}
    for source in refs:
        key = source["document_id"], source["row_id"], source["page"], source["line"]
        selected.setdefault(key, source)
    return list(selected.values())


def _scenario(rows, findings):
    # Select disjoint invoice rows. Overlapping questions remain visible and
    # keep their own proposed impact but contribute at most one adjustment.
    eligible = sorted(
        (item for item in findings if item["status"] == "active" and item["adjustment"] and item["amount"] is not None),
        key=lambda item: (-item["amount"], item["id"]),
    )
    charged_rows = set()
    included = set()
    for item in eligible:
        affected = {(source["document_id"], source["row_id"]) for source in item["evidence"]
                    if source["document_kind"] == "invoice"}
        if affected and charged_rows.isdisjoint(affected):
            included.add(item["id"])
            charged_rows.update(affected)
    selected = [
        {**item, "adjustment": item["id"] in included}
        for item in findings
    ]
    scenario = calculate(rows, selected)
    if any(item["check"] == "line_arithmetic" and item["status"] == "active" for item in findings):
        scenario.update(reconciled=False, conditional=None, adjustments=None, included=[])
    invoice_refs = _unique(ref(pair, "context") for pair in rows if pair[1]["type"] == "invoice_total")
    adjustment_refs = _unique(source for item in findings if item["id"] in scenario["included"] for source in item["evidence"])
    deduction_refs = _unique(ref(pair, "context") for pair in rows if pair[1]["type"] == "deduction")
    scenario["sources"] = {
        "billed": invoice_refs if scenario["billed"] is not None else [],
        "adjustments": (adjustment_refs or invoice_refs) if scenario["adjustments"] is not None else [],
        "conditional": _unique([*invoice_refs, *adjustment_refs]) if scenario["conditional"] is not None else [],
        "unresolved_deduction": deduction_refs if scenario["unresolved_deduction"] is not None else [],
    }
    return scenario


def run_rules(case: dict, *, allow_model: bool = True, allow_fictional: bool = True) -> None:
    loaded = None
    if allow_fictional:
        loaded = load_fictional("rules.json", "FAIRBILL_RULES_FILE")
        enabled = loaded[0]["enabled"]
        if any(type(enabled.get(rule)) is not bool for rule in RULES):
            raise ValueError("Each billing rule requires a boolean enabled setting.")
    else:
        enabled = {rule: rule not in {"unit_limit", "reference_tariff"} for rule in RULES}
    options = [rule for rule in RULES if enabled[rule]]
    decision = gemini(
        Plan, f"Order each of these allowed investigation checks exactly once: {json.dumps(options)}.",
    ) if allow_model and options and eligible_for_model(case) else None
    valid_plan = decision and len(decision.checks) == len(options) and set(decision.checks) == set(options)
    plan = decision.checks if valid_plan else options
    case["agent_mode"] = "Gemini" if valid_plan else "Offline"
    event(case, "Investigation planned", f"{len(plan)} checks selected using {case['agent_mode']}.", "Case investigator")
    rows = [(doc, row) for doc in case["documents"] if doc["confirmed"] for row in doc["rows"]]
    findings = [item for rule in plan for item in RULES[rule](rows, loaded) if item["evidence"]]
    current = {item["id"]: item for item in findings}
    for old in case["findings"]:
        new = current.get(old["id"])
        if new is None and old["status"] in {"active", "withdrawn"}:
            explanation = old["explanation"] if old["status"] == "withdrawn" else (
                "This billing check is disabled for this revision." if not enabled.get(old["check"], False)
                else "The current confirmed evidence no longer supports this question."
            )
            new = {**old, "amount": None, "status": "withdrawn", "adjustment": False, "explanation": explanation}
            findings.append(new)
        if old["status"] == "active" and new and new["status"] == "withdrawn":
            event(case, f"Finding withdrawn: {old['title']}", new["explanation"], "Adversarial reviewer")
    for item in findings:
        item["evidence"] = _unique(item["evidence"])
        item.update(rule_id=item["check"], kind="billing_question", severity="review")
    case["findings"] = findings
    case["scenario"] = _scenario(rows, findings)
    if not enabled["settlement"]:
        case["scenario"]["unresolved_deduction"] = None
        case["scenario"]["sources"]["unresolved_deduction"] = []
    case["investigated_revision"] = case["revision"]
    case["pending"] = []
    event(case, "Scenarios verified", "Amounts calculated in integer paise.", "Scenario planner")
    case["history"].append({
        "revision": case["revision"], "scenario": deepcopy(case["scenario"]),
        "findings": deepcopy(findings), "at": now(),
    })
