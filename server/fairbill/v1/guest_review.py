"""Adopt patient-confirmed local ledger values without uploading an original file."""

import hashlib
import json
from uuid import UUID, uuid5

from fastapi import HTTPException

from ..documents import make_document
from ..investigation import event
from ..resolution import money
from . import store
from .models import GuestAdoption
from .operations import make_case

NAMESPACE = UUID("c7a0547e-b452-427c-9d42-50c6a507b7d4")


def adopt(owner: str, data: GuestAdoption):
    guest_id = str(data.guest_id)
    case_id = str(uuid5(NAMESPACE, f"{owner}:{guest_id}"))
    payload = data.model_dump(mode="json")
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    try:
        existing = store.get(owner, case_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
    else:
        if existing.get("guest_fingerprint") != fingerprint:
            raise HTTPException(409, "This review was already transferred. Open the saved case.")
        return existing

    def create():
        case = make_case(False)
        case["id"] = case_id
        case["guest_fingerprint"] = fingerprint
        raw = ["On-device ledger supplied by the patient"]
        rows = []
        for index, charge in enumerate(data.rows, start=1):
            raw.append(f"{charge.description}  {charge.units} units  {money(charge.amount)}")
            rows.append({
                "id": f"G{index}", "type": "charge", "page": 1, "line": index + 1,
                "description": charge.description, "code": "", "service_date": "",
                "reference": "", "units": charge.units, "amount": charge.amount, "unit_price": None, "received": None,
            })
        if data.invoice_total is not None:
            raw.append(f"Invoice total  {money(data.invoice_total)}")
            rows.append({
                "id": "GT", "type": "invoice_total", "page": 1, "line": len(raw),
                "description": "Invoice total", "code": "", "service_date": "",
                "reference": "", "units": None, "amount": data.invoice_total, "unit_price": None, "received": None,
            })
        doc_id = uuid5(NAMESPACE, f"{case_id}:ledger").hex
        document = make_document(doc_id, "invoice", "\n".join(raw).encode(), pasted=True, versioned=True)
        document["rows"] = rows
        for line in document["extracted_lines"]:
            line["needs_manual_entry"] = False
        document["notes"] = ["Review these device-entered charges against the original bill before confirming."]
        case["documents"] = [document]
        event(case, "On-device review transferred", "You chose to add this ledger to your account.", "Patient")
        return case

    return store.mutate(owner, f"guest-{guest_id}", "adopt-guest-review", payload, create)
