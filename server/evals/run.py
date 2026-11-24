"""Evaluate synthetic cases and generate a reproducible Markdown report."""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from shutil import which

import pymupdf

from fairbill.claims import validate_claims
from fairbill.documents import make_document
from fairbill.rules import RULES, run_rules

HERE = Path(__file__).parent
DEFAULT_REPORT = HERE.parents[1] / "docs" / "eval-report.md"
MODEL_PROBES = (
    ("Ask billing to clarify INR 800.00 and 2 units.", True),
    ("Ask billing to clarify INR 800.01 and 2 units.", False),
    ("Ask billing to clarify INR 800.00 and 20 units.", False),
    ("Ask billing to clarify INR 800 lakh.", False),
    ("Ask billing to clarify forty units.", False),
    ("Ask billing to clarify 200units.", False),
    ("Ask billing why the records show -2 units.", False),
    ("Ask billing to review 800 rupees.", True),
    ("Ask billing to confirm the amounts against the records.", True),
)


def fixtures():
    return [json.loads(path.read_text()) for path in sorted((HERE / "fixtures").glob("*.json"))]


def build_case(fixture):
    documents = [
        make_document(doc["id"], doc["kind"], doc["text"].encode(), pasted=True, trusted=True, versioned=True)
        for doc in fixture["documents"]
    ]
    for document in documents:
        if document["kind"] == "invoice":
            for row in document["rows"]:
                if row["id"] in fixture.get("not_received_rows", []):
                    row["received"] = False
    return {
        "id": fixture["name"], "sample": True, "documents": documents, "findings": [],
        "history": [], "timeline": [], "revision": 1,
    }


def signature(item):
    return item["rule_id"], tuple(sorted(item["rows"])), item["impact_paise"]


def actual_questions(case):
    return [
        {
            "rule_id": item["check"],
            "rows": sorted({source["row_id"] for source in item["evidence"]
                            if source["document_kind"] in {"invoice", "settlement"}}),
            "impact_paise": item["amount"],
        }
        for item in case["findings"] if item["status"] == "active"
    ]


def photo_recall(fixture, case, matrix):
    document = fixture["documents"][0]
    with pymupdf.open() as PDF:
        page = PDF.new_page(width=900, height=260)
        page.insert_textbox(pymupdf.Rect(28, 20, 872, 236), document["text"],
                            fontsize=15, fontname="Courier")
        raster = page.get_pixmap(matrix=matrix, alpha=False).tobytes("jpeg")
    image = make_document("invoice-photo", "invoice", raster, versioned=True)
    fields = ("id", "type", "code", "service_date", "units", "unit_price", "amount")
    def match(keys, *, normalize_code=False):
        def identities(doc):
            return Counter(tuple(row[field].casefold() if field == "code" and normalize_code else row[field]
                                 for field in keys) for row in doc["rows"])
        return (identities(case["documents"][0]) & identities(image)).total()

    return match(fields), match(fields[1:], normalize_code=True), len(case["documents"][0]["rows"])



def measure(*, photos=True):
    counts = defaultdict(Counter)
    misses = []
    false_on_clean = 0
    photos_run = []
    scenarios_checked = 0
    claim_failures = []
    cases = fixtures()
    for fixture in cases:
        case = build_case(fixture)
        run_rules(case, allow_model=False)
        expected = Counter(map(signature, fixture["expected_questions"]))
        actual = Counter(map(signature, actual_questions(case)))
        for comparison, field in [(expected & actual, "tp"), (actual - expected, "fp"), (expected - actual, "fn")]:
            for row, count in comparison.items():
                counts[row[0]][field] += count
                if field != "tp":
                    misses.append(f"{fixture['name']} {field}: {row}")
                    false_on_clean += count if field == "fp" and not expected else 0
        for key in ("conditional", "unresolved_deduction"):
            predicted = case["scenario"][key]
            wanted = fixture[f"expected_{key}_paise"]
            if predicted != wanted:
                misses.append(f"{fixture['name']} {key}: expected {wanted}, got {predicted}")
        scenarios_checked += 1
        if photos and which("tesseract") and fixture.get("photo"):
            for name, matrix in [
                ("clean", pymupdf.Matrix(2, 2)),
                ("slightly skewed", pymupdf.Matrix(1.5, 1.5).prerotate(2)),
            ]:
                exact, values, total = photo_recall(fixture, case, matrix)
                photos_run.append((fixture["name"], name, exact, values, total))
        if fixture["name"] == "12-clean-simple":
            for index, (claim, expected_valid) in enumerate(MODEL_PROBES, start=1):
                if (not validate_claims(claim, case)) != expected_valid:
                    claim_failures.append(index)
    return {
        "counts": counts, "misses": misses, "false_on_clean": false_on_clean, "photos": photos_run,
        "claim_failures": claim_failures, "scenarios_checked": scenarios_checked,
        "seeded_bills": sum(bool(item["expected_questions"]) for item in cases),
        "clean_bills": sum(not item["expected_questions"] for item in cases),
    }


def pct(numerator, denominator):
    if not denominator:
        return "—"
    tenths = (numerator * 1000 + denominator // 2) // denominator
    return f"{tenths // 10}.{tenths % 10}%"


def report(data):
    counts = data["counts"]
    tp = sum(counts[rule]["tp"] for rule in RULES)
    fn = sum(counts[rule]["fn"] for rule in RULES)
    lines = [
        "# FairBill synthetic evaluation", "",
        "Run from the repository root with `make eval`. The harness forces offline rule execution.",
        "", f"- Seeded bills {data['seeded_bills']}. Clean bills {data['clean_bills']}.",
        f"- Seeded questions recovered {tp}/{tp + fn} ({pct(tp, tp + fn)}).",
        f"- False questions on clean bills {data['false_on_clean']}.",
        f"- Scenario totals checked {data['scenarios_checked'] * 2}.",
        f"- Claim-check probes passed {len(MODEL_PROBES) - len(data['claim_failures'])}/{len(MODEL_PROBES)}.",
        "", "A true positive must match the seeded rule, source row IDs, and proposed paise impact.",
        "", "| Rule | True positives | False positives | False negatives | Precision | Recall |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for rule in RULES:
        a, b, c = (counts[rule][key] for key in ("tp", "fp", "fn"))
        lines.append(f"| {rule} | {a} | {b} | {c} | {pct(a, a + b)} | {pct(a, a + c)} |")
    lines += ["", "## OCR line recall", ""]
    if data["photos"]:
        recovered = sum(row[2] for row in data["photos"])
        values = sum(row[3] for row in data["photos"])
        total = sum(row[4] for row in data["photos"])
        lines.append(f"Exact row recall was {recovered}/{total} ({pct(recovered, total)}), matching ID, type, code, date, quantity, unit price, and amount.")
        lines.append(f"Matching with the ID excluded and case-insensitive service codes recovered {values}/{total} rows ({pct(values, total)}).")
        lines += ["", "| Fixture | Raster | Exact rows | Rows with canonical service codes |", "| --- | --- | ---: | ---: |"]
        lines += [f"| {name} | {mode} | {a}/{total} | {b}/{total} |" for name, mode, a, b, total in data["photos"]]
    else:
        lines.append("OCR was not run because Tesseract was unavailable or photo evaluation was disabled.")
    lines += ["", "Generated invoice rasters serve as controlled OCR inputs. Letter O and digit zero were frequently confused in row identifiers, and service code casing varied. Confirm the source rows manually before investigating a scan.",
              "", "## Misses and scope", ""]
    lines += [f"- {miss}" for miss in data["misses"]] or ["The labelled rule fixtures matched their expected findings and totals."]
    lines += [
        "", "These fixtures are fictional. They cover labelled documents and illustrative references.",
        "Coding judgments, device prices, prior authorization, and real eligibility remain outside the evaluated rules.",
        "",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()
    result = measure()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(report(result))
    print(f"Evaluated {result['scenarios_checked']} synthetic bills. Report: {args.report}")
    return 1 if result["misses"] or result["claim_failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
