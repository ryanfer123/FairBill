from collections import Counter
from copy import deepcopy
import json

import pytest

from evals.run import actual_questions, build_case, fixtures, signature
from fairbill.assistance import screen_assistance
from fairbill.claims import validate_claims
from fairbill.reference_data import DATA
from fairbill.rules import run_rules
from fairbill.sample import fixtures as sample_documents


@pytest.mark.parametrize("fixture", fixtures(), ids=lambda item: item["name"])
def test_seeded_and_clean_fixtures(fixture):
    case = build_case(fixture)
    run_rules(case, allow_model=False)
    assert Counter(map(signature, actual_questions(case))) == Counter(map(signature, fixture["expected_questions"]))
    assert case["scenario"]["conditional"] == fixture["expected_conditional_paise"]
    assert case["scenario"]["unresolved_deduction"] == fixture["expected_unresolved_deduction_paise"]
    assert case["agent_mode"] == "Offline"
    assert all(item["rule_id"] == item["check"] and item["kind"] == "billing_question" for item in case["findings"])
    for item in case["findings"]:
        assert item["evidence"]
        assert all(source["document_id"] and source["page"] >= 1 and source["line"] >= 1 for source in item["evidence"])
    for field, sources in case["scenario"]["sources"].items():
        assert bool(sources) == (case["scenario"][field] is not None)


def test_sample_replans_without_changing_prior_record():
    documents = sample_documents()
    case = {
        "id": "sample", "sample": True, "documents": documents[:-1],
        "revision": 1, "findings": [], "history": [], "timeline": [],
    }
    run_rules(case, allow_model=False)
    initial = deepcopy(case["history"][0])
    assert case["scenario"]["conditional"] == 15_540_000
    case["revision"] += 1
    case["documents"].append(documents[-1])
    run_rules(case, allow_model=False)
    assert initial == case["history"][0]
    assert case["scenario"]["conditional"] == 15_630_000
    assert case["scenario"]["adjustments"] == 50_000
    assert case["scenario"]["unresolved_deduction"] == 1_200_000
    duplicate = next(item for item in case["findings"] if item["check"] == "duplicates")
    assert duplicate["status"] == "withdrawn"
    assert any(source["row_id"] == "O2" and source["relation"] == "contradicts" for source in duplicate["evidence"])


def test_rule_config_citation_matches_exact_subsection_and_can_be_disabled(tmp_path, monkeypatch):
    file = DATA / "rules.json"
    case = build_case(fixtures()[5])
    run_rules(case, allow_model=False)
    unit, tariff = [item for item in case["findings"] if item["check"] in {"unit_limit", "reference_tariff"}]
    assert unit["evidence"][-1]["quote"].strip() == '"DEMO-OVERLAP": 2'
    assert tariff["evidence"][-1]["quote"].strip() == '"DEMO-OVERLAP": 50000'
    config = json.loads(file.read_text())
    config["enabled"]["unit_limit"] = False
    alternative = tmp_path / "fictional.json"
    alternative.write_text(json.dumps(config, indent=2))
    monkeypatch.setenv("FAIRBILL_RULES_FILE", str(alternative))
    case["revision"] += 1
    run_rules(case, allow_model=False)
    assert next(item for item in case["findings"] if item["check"] == "unit_limit")["status"] == "withdrawn"
    assert case["scenario"]["adjustments"] == 45_000


def test_fictional_assistance_cites_policy_and_distinguishes_match():
    case = build_case(fixtures()[11])
    match = screen_assistance(case, annual_household_income_paise=30_000_000, household_size=2)
    above = screen_assistance(case, annual_household_income_paise=30_000_001, household_size=2)
    assert match["simulated"] and match["findings"][0]["status"] == "potential_match"
    assert above["findings"][0]["status"] == "no_match"
    clause = match["findings"][0]["source"]
    assert clause["row_id"] == "DEMO-A1"
    assert clause["quote"] == (DATA / "policies/assistance.json").read_text().splitlines()[clause["line"] - 1]
    assert "still needs applicability review" in match["findings"][0]["explanation"]
    with pytest.raises(ValueError):
        screen_assistance(case, annual_household_income_paise=30_000_001, household_size=0)


@pytest.mark.parametrize(("wording", "expected"), [
    ("Ask the billing desk to confirm its orders and records.", []),
    ("Please confirm 2 units and ₹800.00.", []),
    ("Please confirm Rs. 800 and 800 rupees.", []),
    ("Please confirm ₹800.01.", ["ungrounded_money"]),
    ("Please confirm INR 800 lakh.", ["unsupported_number_format"]),
    ("Please confirm 20units.", ["ungrounded_quantity"]),
    ("Please confirm twenty units.", ["unsupported_number_format"]),
    ("Please confirm -2 units.", ["unsupported_number_format"]),
    ("Please confirm ٢٠ units.", ["ungrounded_quantity"]),
    ("Please confirm 2e1 units.", ["unsupported_number_format"]),
    ("Please confirm Rs-2.", ["unsupported_number_format"]),
])
def test_claim_checker_uses_grounded_structured_numbers(wording, expected):
    case = build_case(fixtures()[11])
    run_rules(case, allow_model=False)
    assert validate_claims(wording, case) == expected
