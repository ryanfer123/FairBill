"""Screen against the bundled fictional policy for illustration."""

from collections.abc import Callable

from .reference_data import citation, load_fictional


def load_archived_policy():
    """Offline default. A verified policy importer can supply the same shape later."""
    return load_fictional("policies/assistance.json", "FAIRBILL_ASSISTANCE_FILE")


def screen_assistance(
    _case: dict, *, annual_household_income_paise: int, household_size: int,
    policy_loader: Callable[[], tuple[dict, list[str], str]] = load_archived_policy,
) -> dict:
    loaded = policy_loader()
    policy = loaded[0]
    clause_id = "DEMO-A1"
    clause = policy["clauses"][clause_id]
    if (
        type(annual_household_income_paise) is not int or annual_household_income_paise < 0
        or type(household_size) is not int or not 1 <= household_size <= clause["maximum_household_size"]
    ):
        raise ValueError("Enter nonnegative annual household income in paise and a supported household size.")
    limit = clause["base_annual_income_paise"] + (household_size - 1) * clause["per_additional_member_paise"]
    if type(limit) is not int:
        raise ValueError("The fictional policy threshold must be an integer number of paise.")
    meets = annual_household_income_paise <= limit
    return {
        "policy_id": policy["id"], "simulated": True,
        "findings": [{
            "id": clause_id, "title": "Fictional income threshold",
            "status": "potential_match" if meets else "no_match",
            "explanation": (
                "The entered household income is within the fictional threshold."
                if meets else "The entered household income is above the fictional threshold."
            ) + " This policy citation still needs applicability review.",
            "source": citation(loaded, clause_id),
        }],
    }
