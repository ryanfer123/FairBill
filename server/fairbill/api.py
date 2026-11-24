import hashlib
import hmac
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .documents import MAX_BYTES, ROW_TYPES, Kind, Row, make_document
from .investigation import CHECKS, DEPENDENCIES, event, run
from .resolution import Action, evidence_packet, make_draft, packet_lines
from .sample import fixtures
from .v1 import app as v1_app
from .v1.middleware import profile as api_profile

app = FastAPI(title="FairBill", version="0.1.0", docs_url=None, redoc_url=None)


@app.exception_handler(RequestValidationError)
async def validation_error(_request, error):
    messages = []
    for item in error.errors():
        parts = [str(part) for part in item["loc"][1:]]
        field = ".".join(parts)
        if field:
            messages.append(f"{field}: {item['msg']}")
    return JSONResponse({"detail": " ".join(messages[:3]) or "Check the supplied fields."}, status_code=422)


def db():
    path = Path(os.getenv("FAIRBILL_DB", "../.local/fairbill.sqlite3")).expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(descriptor)
    conn = sqlite3.connect(path, timeout=8)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, serial INTEGER NOT NULL, snapshot TEXT NOT NULL
        )"""
    )
    return conn


def owner(authorization: Annotated[str | None, Header()] = None):
    if not authorization or not re.fullmatch(r"Bearer [a-f0-9]{64}", authorization):
        raise HTTPException(401, "The demo installation token is missing or invalid.")
    return hashlib.sha256(authorization[7:].encode()).hexdigest()


Owner = Annotated[str, Depends(owner)]


def load(case_id: str, owner_id: str) -> tuple[int, dict]:
    conn = db()
    try:
        result = conn.execute(
            "SELECT serial, snapshot FROM cases WHERE id=? AND owner=?", (case_id, owner_id)
        ).fetchone()
    finally:
        conn.close()
    if not result:
        raise HTTPException(404, "Case unavailable for this installation.")
    return result[0], json.loads(result[1])


def save(owner_id: str, serial: int, case: dict) -> dict:
    conn = db()
    try:
        with conn:
            result = conn.execute(
                "UPDATE cases SET serial=serial+1, snapshot=? WHERE id=? AND owner=? AND serial=?",
                (json.dumps(case), case["id"], owner_id, serial),
            )
            if not result.rowcount:
                raise HTTPException(409, "The case changed. Refresh and try again.")
    finally:
        conn.close()
    return case


def check_revision(case: dict, revision: int):
    if case["revision"] != revision:
        raise HTTPException(409, "The case changed. Refresh and try again.")


def check_ready(case):
    if case["investigated_revision"] != case["revision"]:
        raise HTTPException(409, "Run the investigation for this revision first.")


def revise(case, kind):
    case["revision"] += 1
    case["pending"] = [check for check in CHECKS if check in set(case["pending"]) | DEPENDENCIES[kind]]
    case["drafts"] = {}
    case["approvals"] = {}


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Create(Input):
    sample: bool = True


class Revision(Input):
    revision: int = Field(ge=1, strict=True)


class Pasted(Revision):
    kind: Kind
    text: str = Field(min_length=1, max_length=20000)


class Confirm(Revision):
    rows: list[Row] = Field(min_length=1, max_length=150)


class Draft(Revision):
    action: Action


class Approval(Draft):
    hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class Simulation(Approval):
    step: Literal["start", "identity", "finish"] = "start"


@app.get("/health")
def health():
    return {"status": "ok", "demo": "synthetic"}


@app.post("/cases", status_code=201)
def create_case(data: Create, owner_id: Owner):
    case = {
        "id": str(uuid4()), "sample": data.sample, "revision": 1,
        "documents": fixtures()[:-1] if data.sample else [],
        "findings": [], "history": [], "timeline": [], "scenario": None,
        "agent_mode": None, "investigated_revision": None, "pending": list(CHECKS),
        "drafts": {}, "approvals": {}, "receipts": {},
    }
    event(case, "Case opened", "Synthetic demo documents loaded." if data.sample else
          "Ready to import synthetic documents.", "FairBill")
    conn = db()
    try:
        with conn:
            conn.execute("INSERT INTO cases VALUES (?, ?, 0, ?)", (case["id"], owner_id, json.dumps(case)))
    finally:
        conn.close()
    return case


@app.get("/cases/{case_id}")
def get_case(case_id: str, owner_id: Owner):
    return load(case_id, owner_id)[1]


def attach(case, document):
    if len(case["documents"]) >= 12:
        raise HTTPException(422, "This demo case supports up to 12 documents.")
    if document["kind"] == "invoice" and any(doc["kind"] == "invoice" for doc in case["documents"]):
        raise HTTPException(409, "This case already has an invoice. Open a new case for a different bill.")
    if len(document["rows"]) > 150:
        raise HTTPException(422, "Use a document with up to 150 rows.")
    if any(doc["sha256"] == document["sha256"] for doc in case["documents"]):
        raise HTTPException(409, "This document is already in the case.")
    revise(case, document["kind"])
    case["documents"].append(document)
    event(case, "Document added", "Confirm the extracted rows before the investigation uses them.", "Patient")


@app.post("/cases/{case_id}/documents/sample-order")
def add_sample_order(case_id: str, data: Revision, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    check_revision(case, data.revision)
    if not case["sample"]:
        raise HTTPException(422, "The second order belongs to the bundled sample case.")
    document = fixtures()[-1]
    document["confirmed"] = False
    attach(case, document)
    return save(owner_id, serial, case)


@app.post("/cases/{case_id}/documents/text")
def paste(case_id: str, data: Pasted, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    check_revision(case, data.revision)
    try:
        document = make_document(uuid4().hex, data.kind, data.text.encode(), pasted=True)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    attach(case, document)
    return save(owner_id, serial, case)


@app.post("/cases/{case_id}/documents/file")
async def upload(case_id: str, owner_id: Owner, revision: Annotated[int, Form(ge=1)],
                 kind: Annotated[Kind, Form()], file: Annotated[UploadFile, File()]):
    serial, case = await run_in_threadpool(load, case_id, owner_id)
    check_revision(case, revision)
    try:
        buffer = await file.read(MAX_BYTES + 1)
        document = await run_in_threadpool(make_document, uuid4().hex, kind, buffer)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        await file.close()
    attach(case, document)
    return await run_in_threadpool(save, owner_id, serial, case)


@app.post("/cases/{case_id}/documents/{doc_id}/confirm")
def confirm(case_id: str, doc_id: str, data: Confirm, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    check_revision(case, data.revision)
    doc = next((doc for doc in case["documents"] if doc["id"] == doc_id), None)
    if not doc:
        raise HTTPException(404, "Document unavailable.")
    if len({row.id for row in data.rows}) != len(data.rows):
        raise HTTPException(422, "Each document row needs a unique ID.")
    for row in data.rows:
        if row.type not in ROW_TYPES[doc["kind"]] or row.page > len(doc["pages"]):
            raise HTTPException(422, "The row type or page does not match this document.")
        if row.line > max(1, len(doc["pages"][row.page - 1].splitlines())):
            raise HTTPException(422, "Use a line number from the displayed page.")
    rows = [row.model_dump() for row in data.rows]
    if doc["confirmed"] and rows == doc["rows"]:
        return case
    previous = {row["id"]: row for row in doc["rows"]}
    edited = {row["id"] for row in rows if previous.get(row["id"]) != row}
    doc["edited_rows"] = sorted(edited | set(doc.get("edited_rows", [])))
    if rows != doc["rows"]:
        doc["bundled"] = False
    doc["rows"] = rows
    doc["confirmed"] = True
    revise(case, doc["kind"])
    event(case, "Rows confirmed", f"{len(rows)} rows confirmed by the patient.", "Patient")
    return save(owner_id, serial, case)


@app.post("/cases/{case_id}/documents/{doc_id}/discard")
def discard(case_id: str, doc_id: str, data: Revision, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    check_revision(case, data.revision)
    document = next((doc for doc in case["documents"] if doc["id"] == doc_id), None)
    if not document:
        raise HTTPException(404, "Document unavailable.")
    if document["confirmed"]:
        raise HTTPException(409, "Only an unconfirmed import can be discarded.")
    case["documents"].remove(document)
    revise(case, document["kind"])
    event(case, "Unconfirmed import discarded", "The document was removed before it entered the investigation.", "Patient")
    return save(owner_id, serial, case)


@app.post("/cases/{case_id}/investigate")
def investigate(case_id: str, data: Revision, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    check_revision(case, data.revision)
    if case["investigated_revision"] == case["revision"]:
        return case
    if not any(doc["confirmed"] and doc["kind"] == "invoice" for doc in case["documents"]):
        raise HTTPException(422, "Add and confirm a hospital invoice first.")
    if any(not doc["confirmed"] for doc in case["documents"]):
        raise HTTPException(422, "Confirm the newly added documents first.")
    run(case)
    return save(owner_id, serial, case)


@app.post("/cases/{case_id}/drafts")
def draft(case_id: str, data: Draft, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    check_revision(case, data.revision)
    check_ready(case)
    if data.action in case["drafts"]:
        return case
    make_draft(case, data.action)
    return save(owner_id, serial, case)


def exact_draft(case, data):
    check_revision(case, data.revision)
    check_ready(case)
    current = case["drafts"].get(data.action)
    if not current or not hmac.compare_digest(current["hash"], data.hash):
        raise HTTPException(409, "Review the current wording before you continue.")
    return current


@app.post("/cases/{case_id}/approvals")
def approve(case_id: str, data: Approval, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    current = exact_draft(case, data)
    if data.action in case["approvals"]:
        return case
    case["approvals"][data.action] = current
    event(case, f"{data.action.title()} approved", "The patient approved this revision's exact wording.", "Patient")
    return save(owner_id, serial, case)


@app.post("/cases/{case_id}/simulations")
def simulate(case_id: str, data: Simulation, owner_id: Owner):
    serial, case = load(case_id, owner_id)
    exact_draft(case, data)
    approved = case["approvals"].get(data.action)
    if not approved or not hmac.compare_digest(approved["hash"], data.hash):
        raise HTTPException(403, "Patient approval is required.")
    key = f"{data.revision}:{data.action}:{data.hash}"
    existing = case["receipts"].get(key)
    if data.action == "letter" and data.step != "start":
        raise HTTPException(422, "Choose the simulated send action.")
    if data.step == "start" and not existing:
        receipt = {
            "action": data.action, "revision": data.revision, "id": f"DEMO-{uuid4().hex[:8].upper()}",
            "state": "awaiting_identity" if data.action == "call" else "completed",
        }
        case["receipts"][key] = receipt
        event(case, "Simulated call started" if data.action == "call" else "Simulated letter sent",
              "The patient joined. The advocate disclosed its role." if data.action == "call" else
              f"Local receipt {receipt['id']}.", "FairBill")
    elif not existing:
        raise HTTPException(409, "Start the simulated call first.")
    elif data.step == "identity" and existing["state"] == "awaiting_identity":
        existing["state"] = "verified"
        event(case, "Patient verified identity", "The advocate can now ask the billing desk for records.", "Patient")
    elif data.step == "finish" and existing["state"] == "awaiting_identity":
        raise HTTPException(409, "The patient must verify their own identity first.")
    elif data.step == "finish" and existing["state"] == "verified":
        existing["state"] = "completed"
        event(case, "Simulated call completed", f"Billing acknowledged the requests. Reference {existing['id']}.",
              "Billing desk simulation")
    else:
        return case
    return save(owner_id, serial, case)


@app.get("/cases/{case_id}/packet")
def packet(case_id: str, revision: int, owner_id: Owner, preview: bool = False):
    _, case = load(case_id, owner_id)
    check_revision(case, revision)
    check_ready(case)
    lines = packet_lines(case)
    if preview:
        return JSONResponse({"lines": lines}, headers={"Cache-Control": "no-store"})
    return Response(evidence_packet(lines), media_type="application/pdf", headers={
        "Content-Disposition": "attachment; filename=FairBill-evidence.pdf", "Cache-Control": "no-store",
    })


@app.middleware("http")
async def restrict_hosted_legacy(request, call_next):
    if api_profile() == "fixtures" and not request.url.path.startswith("/v1/"):
        return JSONResponse({"code": "not_found", "message": "Use the versioned API.", "details": []}, status_code=404)
    return await call_next(request)


app.mount("/v1", v1_app)
