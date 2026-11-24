"""Load local, explicitly fictional case reference data."""

import hashlib
import json
import os
from pathlib import Path

DATA = Path(__file__).with_name("data")


def load_fictional(relative: str, environment: str) -> tuple[dict, list[str], str]:
    path = Path(os.getenv(environment) or (DATA / relative))
    blob = path.read_bytes()
    body = blob.decode("utf-8")
    config = json.loads(body)
    if config.get("fictional") is not True or not isinstance(config.get("id"), str):
        raise ValueError("Reference data must have an ID and be explicitly marked fictional.")
    return config, body.splitlines(), hashlib.sha256(blob).hexdigest()


def citation(loaded: tuple[dict, list[str], str], key: str, *, section: str | None = None) -> dict:
    config, lines, digest = loaded
    prefix = f"{json.dumps(key)}:"
    section_prefix = f"{json.dumps(section)}:" if section is not None else None
    inside = section_prefix is None
    for line, quote in enumerate(lines, start=1):
        stripped = quote.lstrip()
        if not inside:
            inside = stripped.startswith(section_prefix)
            continue
        if section_prefix is not None and stripped.startswith("}"):
            break
        if stripped.startswith(prefix):
            return {
                "document_id": config["id"], "document_kind": "policy", "sha256": digest,
                "page": 1, "line": line, "row_id": key, "quote": quote,
                "basis": "document", "relation": "context",
            }
    raise ValueError(f"Reference {key!r} has no source line.")
