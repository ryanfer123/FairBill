"""Packet redaction and independent checks against known case identifiers."""

import re
import unicodedata
from collections.abc import Iterable

LABEL = (
    r"(?:patient(?:[ _-]+(?:name|id|number))?|full[ _-]+name|name|"
    r"(?:mobile|telephone|phone)(?:[ _-]+(?:number|no))?|"
    r"(?:email|e-mail)(?:[ _-]+address)?|(?:postal[ _-]+|home[ _-]+)?address|"
    r"(?:policy|insurance|member|claim|aadhaar|aadhar|pan|hospital[ _-]+record|medical[ _-]+record|mrn)"
    r"(?:[ _-]+(?:id|number|no|identifier))?|(?:government|national)[ _-]+id)"
)
LABELED = re.compile(
    rf"(?im)(^|[|;])([ \t]*{LABEL}[ \t]*[:=#][ \t]*)([^\r\n|;]+)"
)
PATTERNS = (
    re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"),
    re.compile(r"(?<!\d)(?:\+91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)"),
    re.compile(r"(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}(?!\d)"),
    re.compile(r"(?i)\b[A-Z]{5}\d{4}[A-Z]\b"),
)
FIELD = re.compile(rf"^{LABEL}$", re.IGNORECASE)
REDACTED = "[redacted]"


class RedactionError(ValueError):
    """Raised when a packet still contains a known identifier."""


def _structured(data) -> Iterable[str]:
    if isinstance(data, dict):
        for key, value in data.items():
            if FIELD.fullmatch(key) and isinstance(value, (str, int)):
                yield str(value)
            elif isinstance(value, (dict, list)):
                yield from _structured(value)
    elif isinstance(data, list):
        for value in data:
            yield from _structured(value)


def known_values(case: dict, additional: Iterable[str] = (), *, letter: str | None = None) -> set[str]:
    values = set(_structured(case))
    values.update(additional)
    pages = [page for document in case.get("documents", []) for page in document.get("pages", [])]
    if letter:
        pages.append(letter)
    for page in pages:
        values.update(match[3].strip() for match in LABELED.finditer(page))
        values.update(match[0] for pattern in PATTERNS for match in pattern.finditer(page))
    return {value.strip() for value in values if isinstance(value, str)
            and value.strip().casefold() not in {REDACTED, "none", "n/a"} and len(value.strip()) >= 2}


def redact_text(text: str, private: set[str]) -> str:
    text = LABELED.sub(lambda match: match[1] + match[2] + REDACTED, text)
    for pattern in PATTERNS:
        text = pattern.sub(REDACTED, text)
    for value in sorted(private, key=len, reverse=True):
        text = re.sub(rf"(?<!\w){re.escape(value)}(?!\w)", REDACTED, text, flags=re.IGNORECASE)
    return text


def _normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def assert_no_private_values(text: str, private: set[str]) -> None:
    normalized = _normalized(text)
    for value in private:
        needle = _normalized(value)
        if re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", normalized):
            raise RedactionError("The evidence packet could not pass its identity redaction check.")
        digits = re.sub(r"[^\d]", "", needle)
        if len(digits) >= 9 and not re.search(r"[^\d+(). -]", needle):
            separated = r"[ ().-]*".join(digits)
            if re.search(rf"(?<!\d){separated}(?!\d)", normalized):
                raise RedactionError("The evidence packet could not pass its identity redaction check.")
    for match in LABELED.finditer(text):
        if match[3].strip() != REDACTED:
            raise RedactionError("The evidence packet could not pass its identity redaction check.")
    if any(pattern.search(text) for pattern in PATTERNS):
        raise RedactionError("The evidence packet could not pass its identity redaction check.")
