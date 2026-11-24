import hashlib
import hmac
from uuid import uuid4

from fastapi import HTTPException

from ..investigation import CHECKS, event, now
from .models import Simulate
from .middleware import profile

MAX_IDENTITY_ATTEMPTS = 3


def document(case, doc_id):
    match = next((entry for entry in case["documents"] if entry["id"] == doc_id), None)
    if match is None:
        raise HTTPException(404, "Document unavailable.")
    return match


def for_local():
    if profile() == "fixtures":
        raise HTTPException(403, "This release accepts only the bundled synthetic fixtures.")


def is_live_case(case):
    return profile() == "hosted" and not case["sample"]


def make_case(sample: bool):
    from ..sample import fixtures

    case = {
        "id": str(uuid4()), "sample": sample, "revision": 1,
        "documents": fixtures()[:-1] if sample else [],
        "findings": [], "history": [], "timeline": [], "scenario": None,
        "agent_mode": None, "investigated_revision": None, "pending": list(CHECKS),
        "drafts": {}, "approvals": {}, "receipts": {}, "draft_history": [],
    }
    if sample:
        detail = "Synthetic demo documents loaded."
    elif profile() == "hosted":
        detail = "Ready to import documents."
    else:
        detail = "Ready to import synthetic documents."
    event(case, "Case opened", detail, "FairBill")
    return case


def invalidate(case):
    case["drafts"] = {}
    case["approvals"] = {}


def add_draft_version(case, action, draft, edited=False):
    versions = case.setdefault("draft_history", [])
    previous = case["drafts"].get(action)
    if previous and not any(item["hash"] == previous["hash"] and item["revision"] == previous["revision"]
                            and item["action"] == action for item in versions):
        versions.append({**previous, "version": 1, "simulated": not is_live_case(case)})
    number = 1 + max((item["version"] for item in versions
                      if item["action"] == action and item["revision"] == case["revision"]), default=0)
    version = {**draft, "version": number, "at": now(), "simulated": not is_live_case(case)}
    versions.append(version)
    case["drafts"][action] = version
    if edited:
        case["approvals"].pop(action, None)
        event(case, "Letter edited", "Approval was cleared. Review and approve the updated wording.", "Patient")


def edit_draft(case, text):
    previous = case["drafts"].get("letter")
    if not previous:
        raise HTTPException(409, "Prepare a clarification letter first.")
    if text == previous["text"]:
        return
    if not text.strip():
        raise HTTPException(422, "Enter the letter wording.")
    # Preserve exact text while preventing a previously used hash from ever inheriting an approval.
    draft = {**previous, "text": text, "hash": hashlib.sha256(text.encode()).hexdigest(), "mode": "Offline"}
    add_draft_version(case, "letter", draft, edited=True)


def turn(speaker, text):
    return {"speaker": speaker, "text": text, "at": now(), "simulated": True}


def simulated(case, draft, data: Simulate):
    approved = case["approvals"].get(data.action)
    if not approved or not hmac.compare_digest(approved["hash"], data.hash):
        raise HTTPException(403, "Patient approval is required.")
    key = f"{data.revision}:{data.action}:{data.hash}"
    existing = case["receipts"].get(key)

    if data.action == "letter":
        if data.step != "start":
            raise HTTPException(422, "Choose the simulated send action.")
        if existing is None:
            receipt = base_receipt(data, "completed", "letter")
            receipt["outcome"] = "sent"
            case["receipts"][key] = receipt
            event(case, "Simulated letter sent", f"Local receipt {receipt['id']}.", "FairBill")
        return

    if data.step == "start":
        if existing is not None:
            raise HTTPException(409, "This simulated call already has a session.")
        receipt = base_receipt(data, "awaiting_identity", "call")
        receipt.update(progress="IDENTITY_PENDING", attempts=0, turns=[
            turn("system", "Simulated call started. The advocate waits for patient identity verification."),
            turn("billing", "Please verify your identity."),
        ])
        case["receipts"][key] = receipt
        event(case, "Simulated call started", "The advocate waits for patient identity verification.", "FairBill")
        return

    if not existing:
        raise HTTPException(409, "Start the simulated call first.")
    if "progress" not in existing:
        existing["progress"] = {
            "awaiting_identity": "IDENTITY_PENDING", "verified": "IDENTITY_VERIFIED", "completed": "ENDED",
        }[existing["state"]]
        existing["turns"] = []
        existing["attempts"] = 0

    progress = existing["progress"]
    if data.step in {"identity", "identity_failed"}:
        if progress != "IDENTITY_PENDING":
            raise HTTPException(409, "This call is not waiting for identity verification.")
        if data.step == "identity_failed":
            existing["attempts"] += 1
            existing["turns"].append(turn("patient", "Identity verification attempt unsuccessful."))
            if existing["attempts"] >= MAX_IDENTITY_ATTEMPTS:
                existing.update(progress="ENDED", state="completed", outcome="identity_failed")
                existing["turns"].append(turn("system", "Simulation ended without identity verification."))
                event(case, "Simulated call ended", "Identity verification did not succeed.", "FairBill")
            return
        existing.update(progress="IDENTITY_VERIFIED", state="verified")
        existing["turns"].append(turn("patient", "I verified my own identity."))
        event(case, "Patient verified identity", "The advocate can now ask the billing desk for records.", "Patient")
    elif data.step in {"activate", "finish"}:
        if progress == "IDENTITY_PENDING":
            raise HTTPException(409, "The patient must verify their own identity first.")
        if progress == "IDENTITY_VERIFIED":
            existing.update(progress="ADVOCATE_ACTIVE", state="verified")
            existing["turns"].append(turn("advocate", draft["text"]))
            event(case, "Advocate joined simulation", "The advocate used the approved script after verification.", "FairBill")
            if data.step == "activate":
                return
        elif progress != "ADVOCATE_ACTIVE" or data.step == "activate":
            raise HTTPException(409, "That step is unavailable in the current simulated call state.")
        existing.update(progress="ENDED", state="completed", outcome="completed")
        existing["turns"].append(turn("billing", f"Requests acknowledged. Simulated reference {existing['id']}."))
        event(case, "Simulated call completed", f"Billing acknowledged the requests. Reference {existing['id']}.",
              "Billing desk simulation")


def base_receipt(data, state, channel):
    return {
        "action": data.action, "revision": data.revision, "id": f"DEMO-{uuid4().hex[:8].upper()}",
        "state": state, "simulated": True, "hash": data.hash, "at": now(), "channel": channel,
    }
