"""Deterministically validate explicit numerical claims before a draft can be approved."""

import re
import unicodedata

from .documents import paise

_NUMBER = r"[0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?"
_CURRENCY = r"(?:\bINR\b|₹|\bRs(?=[.\s+−0-9-])|\brupees?\b|\bpaise\b)"
_PREFIX_MONEY = re.compile(rf"(?<!\w)(?:₹|INR\b|Rs\.?(?=\s|[0-9]))\s*(?P<value>{_NUMBER})(?![\w,]|\.[0-9])", re.I)
_SUFFIX_MONEY = re.compile(rf"(?<![\w,.])(?P<value>{_NUMBER})\s+(?P<currency>rupees?|paise|INR|Rs\.?)\b", re.I)
_GROUPED = re.compile(r"(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3})(?:\.[0-9]{1,2})?")
_RESERVED_NUMBERS = re.compile(
    r"(?<!\w)[0-9]+(?:[.,][0-9]+)*(?=\b|(?:units?|visits?|orders?|services?|charges?|tests?)\b)",
    re.I,
)
_REFERENCE_ID = re.compile(r"[A-Za-z]+(?:[-_][A-Za-z0-9]+)*[-_][0-9][A-Za-z0-9]*")
_SIGNED_OR_COMPOUND = re.compile(
    r"(?<!\w)[−+-]\s*[0-9]|[0-9]\s*[/⁄×]\s*[0-9]|\b[0-9]+(?:\.[0-9]+)?[eE][+-]?[0-9]+"
)
_SCALE = re.compile(r"(?<=\d)\s*(?:lakh|lac|crore|thousand|million|billion)\b", re.I)
_WORD_NUMBER = re.compile(
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|"
    r"fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|lakh|crore|half|dozen)"
    r"(?=[\s-]+(?:units?|visits?|orders?|services?|rupees?|paise|INR|charges?|tests?)\b)", re.I,
)


def _facts(case: dict) -> tuple[set[int], set[int], set[str]]:
    amounts = set()
    quantities = set()
    identifiers = set()
    for document in case.get("documents", []):
        if not document["confirmed"]:
            continue
        for row in document["rows"]:
            amounts.update(row[key] for key in ("amount", "unit_price") if type(row.get(key)) is int)
            if type(row.get("units")) is int:
                quantities.add(row["units"])
            if row.get("service_date"):
                identifiers.add(row["service_date"])
            if _REFERENCE_ID.fullmatch(row.get("reference", "")):
                identifiers.add(row["reference"])
    for item in case.get("findings", []):
        if item.get("status") != "withdrawn" and item.get("evidence") and type(item.get("amount")) is int:
            amounts.add(item["amount"])
    scenario = case.get("scenario") or {}
    sources = scenario.get("sources") or {}
    amounts.update(value for key, value in scenario.items() if type(value) is int and sources.get(key))
    return amounts, quantities, identifiers


def validate_claims(text: str, case: dict) -> list[str]:
    """Return fixed rejection codes. Never echo draft text into error or log output."""

    amounts, quantities, identifiers = _facts(case)
    normalized = "".join(
        str(unicodedata.decimal(char)) if char.isdecimal() else char
        for char in unicodedata.normalize("NFKC", text)
    )
    errors = set()
    if _SCALE.search(normalized) or _WORD_NUMBER.search(normalized):
        errors.add("unsupported_number_format")
    for identifier in sorted(identifiers, key=lambda value: (-len(value), value)):
        normalized = re.sub(rf"(?<![\w.]){re.escape(identifier)}(?![\w.])", " ", normalized)

    def check_money(match: re.Match) -> str:
        raw = match["value"]
        before = match.string[:match.start()]
        sign = before.rstrip()[-1:]
        minor = match.groupdict().get("currency", "").casefold() == "paise"
        value = None
        if _GROUPED.fullmatch(raw) and sign not in {"-", "−", "+"}:
            try:
                value = int(raw.replace(",", "")) if minor else paise(raw)
            except ValueError:
                pass
        if value not in amounts:
            errors.add("ungrounded_money")
        return " "

    normalized = _PREFIX_MONEY.sub(check_money, normalized)
    normalized = _SUFFIX_MONEY.sub(check_money, normalized)
    if re.search(_CURRENCY, normalized, re.I):
        errors.add("unsupported_number_format")
    if _SIGNED_OR_COMPOUND.search(normalized):
        errors.add("unsupported_number_format")
    for token in _RESERVED_NUMBERS.findall(normalized):
        if not token.isdigit() or len(token) > 10 or int(token) not in quantities:
            errors.add("ungrounded_quantity")
    return sorted(errors)
