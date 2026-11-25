"""Versioned HTTP contract for the FairBill case workflow."""

import hashlib
import hmac
import os
import re
import shutil
import sqlite3
from functools import partial
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.exceptions import HTTPException as StarletteHTTPException

from .. import documents, resolution
from ..assistance import screen_assistance
from ..documents import MAX_BYTES, ROW_TYPES, Kind
from ..investigation import event, now
from ..india_pilot import PilotInput, PilotReview, review_case
from ..rules import run_rules
from ..sample import fixtures
from . import models as m
from . import cloud, store
from .middleware import RequestContext, error, profile, route_error
from .operations import add_draft_version, document, edit_draft, for_local, invalidate, is_live_case, make_case, simulated

app = FastAPI(
    title="FairBill API", version="1.0.0", docs_url=None, redoc_url=None,
    servers=[{"url": "/v1", "description": "FairBill V1 API"}],
    responses={code: {"model": m.Error} for code in (400, 401, 403, 404, 409, 413, 422, 429, 503)},
)
origins = [origin.strip() for origin in os.getenv("FAIRBILL_CORS_ORIGINS", "").split(",") if origin.strip()]
if origins and profile() == "local":
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
app.add_middleware(RequestContext)
bearer = HTTPBearer(auto_error=False)


@app.exception_handler(StarletteHTTPException)
async def http_error(_request, exc):
    detail = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
    return route_error(exc.status_code, detail, exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc):
    details = [
        {"field": ".".join(str(part) for part in entry["loc"][1:]), "code": entry["type"]}
        for entry in exc.errors()[:12]
    ]
    return error(422, "validation_error", "Check the supplied fields.", details)


@app.exception_handler(sqlite3.Error)
@app.exception_handler(OSError)
async def storage_error(_request, _exc):
    return route_error(503, "The case store is unavailable. Try again.")


Bearer = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def request_owner(
    authorization: Bearer,
    invite: Annotated[str | None, Header(alias="X-FairBill-Invite", max_length=128)] = None,
) -> str:
    if profile() == "hosted":
        if authorization is None:
            raise cloud.unauthorized()
        return cloud.authenticate(authorization.credentials)
    if authorization is None or not re.fullmatch(r"[a-f0-9]{64}", authorization.credentials):
        raise HTTPException(401, "The demo installation token is missing or invalid.", {"WWW-Authenticate": "Bearer"})
    token = authorization.credentials
    if profile() == "fixtures":
        expected = os.getenv("FAIRBILL_INVITE_CODE")
        if not expected:
            raise HTTPException(503, "The fixture release is not configured.")
        if invite is None or not hmac.compare_digest(invite.encode(), expected.encode()):
            raise HTTPException(403, "A valid testing invite is required.")
        token = f"fixtures:{token}"
    return hashlib.sha256(token.encode()).hexdigest()


Owner = Annotated[str, Depends(request_owner)]
Key = Annotated[str | None, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9._:-]{1,128}$")]


def require_demo():
    if profile() == "hosted":
        raise HTTPException(404, "This action is unavailable on the hosted service.")


def mutate(owner, case_id, key, reason, data, apply, *, persist=None):
    from ..api import check_revision

    def run(case):
        check_revision(case, data.revision)
        apply(case)
        return case

    return store.mutate(owner, key, reason, data.model_dump(), run, case_id, persist=persist)


@app.get("/health", response_model=m.Health, responses={503: {"model": m.Health}})
def health(response: Response):
    current = profile()
    configured = current != "fixtures" or bool(os.getenv("FAIRBILL_INVITE_CODE"))
    try:
        store.health()
        db = "ok"
    except (OSError, sqlite3.Error):
        db = "unavailable"
    ocr_available = current != "fixtures" and bool(shutil.which("tesseract"))
    ready = db == "ok" and configured and (current != "hosted" or ocr_available)
    health_result = {
        "status": "ok" if ready else "degraded",
        "demo": None if current == "hosted" else "synthetic", "profile": current,
        "mode": "Gemini" if current == "local" and os.getenv("GEMINI_API_KEY") else "Offline",
        "ocr_available": ocr_available, "db": db,
    }
    if health_result["status"] != "ok":
        return JSONResponse(health_result, status_code=503)
    if current == "hosted":
        response.headers["X-FairBill-Features"] = "india-review"
    return health_result


@app.delete("/account", status_code=204, response_class=Response)
def delete_account(owner: Owner):
    if profile() != "hosted":
        raise HTTPException(404, "Account deletion is available for hosted accounts.")
    cloud.delete_account(owner)
    return Response(status_code=204)


@app.post("/cases", status_code=201, response_model=m.Case)
def create_case(data: m.Create, owner: Owner, key: Key = None):
    hosted = profile() == "hosted"
    sample = (not hosted) if data.sample is None else data.sample
    if sample:
        require_demo()
    else:
        for_local()
    return store.mutate(owner, key, "create", {"sample": sample}, partial(make_case, sample))


@app.get("/cases", response_model=m.CasePage)
def list_cases(owner: Owner, after: Annotated[str, Query(max_length=36)] = "",
               limit: Annotated[int, Query(ge=1, le=50)] = 25):
    return store.list_cases(owner, limit, after)


@app.get("/cases/{case_id}", response_model=m.Case)
def get_case(case_id: str, owner: Owner):
    return store.get(owner, case_id)


@app.get("/cases/{case_id}/documents/{doc_id}", response_model=m.Document)
@app.get("/cases/{case_id}/documents/{doc_id}/extracted", response_model=m.Document)
def get_document(case_id: str, doc_id: str, owner: Owner):
    return document(store.get(owner, case_id), doc_id)


@app.post("/cases/{case_id}/documents/sample-order", response_model=m.Case)
def sample_order(case_id: str, data: m.Version, owner: Owner, key: Key = None):
    from ..api import attach

    require_demo()

    def apply(case):
        if not case["sample"]:
            raise HTTPException(422, "The second order belongs to the bundled sample case.")
        order = fixtures()[-1]
        order["confirmed"] = False
        attach(case, order)

    return mutate(owner, case_id, key, "sample_order", data, apply)


def import_document(case_id, owner, key, data, kind, blob, *, pasted=False, media_type=None, token=None):
    from ..api import attach

    created = None
    stored = False

    def apply(case):
        nonlocal created
        try:
            created = documents.make_document(
                uuid4().hex, kind, blob, versioned=True, pasted=pasted, media_type=media_type,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        attach(case, created)

    def persist():
        nonlocal stored
        if profile() == "hosted":
            return cloud.stage_original(owner, cloud.case_uuid(case_id), created, blob, token)
        documents.store_original(owner, case_id, created, blob)
        stored = True

    try:
        return mutate(owner, case_id, key, "import_document", data, apply, persist=persist)
    except BaseException:
        if stored:
            documents.remove_original(owner, case_id, created)
        raise


@app.post("/cases/{case_id}/documents/text", response_model=m.Case)
def paste(case_id: str, data: m.Paste, owner: Owner, authorization: Bearer, key: Key = None):
    for_local()
    return import_document(case_id, owner, key, data, data.kind, data.text.encode(), pasted=True,
                           media_type="text/plain", token=authorization.credentials)


@app.post("/cases/{case_id}/documents/file", response_model=m.Case)
async def upload(case_id: str, owner: Owner, authorization: Bearer, revision: Annotated[int, Form(ge=1)],
                 kind: Annotated[Kind, Form()], file: Annotated[UploadFile, File()], key: Key = None):
    try:
        for_local()
        blob = await file.read(MAX_BYTES + 1)
    finally:
        await file.close()
    if len(blob) > MAX_BYTES:
        raise HTTPException(413, "Choose a document up to 10 MB.")
    data = m.UploadVersion(revision=revision, kind=kind, sha256=hashlib.sha256(blob).hexdigest(),
                           media_type=file.content_type)
    return await run_in_threadpool(partial(
        import_document, case_id, owner, key, data, kind, blob, media_type=file.content_type,
        token=authorization.credentials,
    ))


def confirm_rows(case, doc, rows):
    from ..api import revise

    if len({row["id"] for row in rows}) != len(rows):
        raise HTTPException(422, "Each document row needs a unique ID.")
    for row in rows:
        if row["type"] not in ROW_TYPES[doc["kind"]] or row["page"] > len(doc["pages"]):
            raise HTTPException(422, "The row type or page does not match this document.")
        if row["line"] > max(1, len(doc["pages"][row["page"] - 1].splitlines())):
            raise HTTPException(422, "Use a line number from the displayed page.")
    if doc["confirmed"] and rows == doc["rows"]:
        return
    before = {row["id"]: row for row in doc["rows"]}
    edited = {row["id"] for row in rows if before.get(row["id"]) != row}
    doc["edited_rows"] = sorted(edited | set(doc.get("edited_rows", [])))
    if rows != doc["rows"]:
        doc["bundled"] = False
    doc["rows"] = rows
    doc["confirmed"] = True
    revise(case, doc["kind"])
    event(case, "Rows confirmed", f"{len(rows)} rows confirmed by the patient.", "Patient")


@app.post("/cases/{case_id}/documents/{doc_id}/confirm", response_model=m.Case)
def confirm(case_id: str, doc_id: str, data: m.Confirm, owner: Owner, key: Key = None):
    def apply(case):
        doc = document(case, doc_id)
        rows = [row.model_dump() for row in data.rows] if data.rows is not None else doc["rows"]
        if profile() == "fixtures" and rows != doc["rows"]:
            for_local()
        if not rows:
            raise HTTPException(422, "At least one document line is required.")
        confirm_rows(case, doc, rows)

    return mutate(owner, case_id, key, f"confirm:{doc_id}", data, apply)


def modify_row(case_id, doc_id, row_id, data, owner, key, change):
    for_local()

    def apply(case):
        doc = document(case, doc_id)
        if not doc["confirmed"]:
            raise HTTPException(409, "Confirm the document lines first.")
        if not any(row["id"] == row_id for row in doc["rows"]):
            raise HTTPException(404, "Document line unavailable.")
        rows = []
        for row in doc["rows"]:
            updated = row if row["id"] != row_id else change(row)
            if updated is not None:
                rows.append(updated)
        confirm_rows(case, doc, rows)

    return mutate(owner, case_id, key, f"row:{type(data).__name__}:{doc_id}:{row_id}", data, apply)


@app.patch("/cases/{case_id}/documents/{doc_id}/rows/{row_id}", response_model=m.Case)
def edit_row(case_id: str, doc_id: str, row_id: str, data: m.EditRow, owner: Owner, key: Key = None):
    if data.row.id != row_id:
        raise HTTPException(422, "The document line ID does not match.")
    return modify_row(case_id, doc_id, row_id, data, owner, key, lambda _row: data.row.model_dump())


@app.delete("/cases/{case_id}/documents/{doc_id}/rows/{row_id}", response_model=m.Case)
def delete_row(case_id: str, doc_id: str, row_id: str, data: m.Version, owner: Owner, key: Key = None):
    return modify_row(case_id, doc_id, row_id, data, owner, key, lambda _row: None)


@app.post("/cases/{case_id}/documents/{doc_id}/rows/{row_id}/received", response_model=m.Case)
def mark_received(case_id: str, doc_id: str, row_id: str, data: m.Received, owner: Owner, key: Key = None):
    def change(row):
        if row["type"] != "charge":
            raise HTTPException(422, "Service receipt applies to charge lines only.")
        return {**row, "received": data.received}

    return modify_row(case_id, doc_id, row_id, data, owner, key, change)


@app.post("/cases/{case_id}/documents/{doc_id}/discard", response_model=m.Case)
def discard(case_id: str, doc_id: str, data: m.Version, owner: Owner, key: Key = None):
    from ..api import revise

    def apply(case):
        doc = document(case, doc_id)
        if doc["confirmed"]:
            raise HTTPException(409, "Only an unconfirmed import can be discarded.")
        case["documents"].remove(doc)
        revise(case, doc["kind"])
        event(case, "Unconfirmed import discarded", "The document was removed before investigation.", "Patient")

    return mutate(owner, case_id, key, f"discard:{doc_id}", data, apply)


@app.post("/cases/{case_id}/investigate", response_model=m.Case)
def investigate(case_id: str, data: m.Version, owner: Owner, key: Key = None):
    def apply(case):
        if not any(doc["confirmed"] and doc["kind"] == "invoice" for doc in case["documents"]):
            raise HTTPException(422, "Add and confirm a hospital invoice first.")
        if any(not doc["confirmed"] for doc in case["documents"]):
            raise HTTPException(422, "Confirm the newly added documents first.")
        case["revision"] += 1
        invalidate(case)
        run_rules(case, allow_model=profile() == "local", allow_fictional=not is_live_case(case))

    return mutate(owner, case_id, key, "investigate", data, apply)


@app.get("/cases/{case_id}/revisions", response_model=list[m.Investigation])
def revisions(case_id: str, owner: Owner):
    return store.get(owner, case_id)["history"]


def get_revision(case, version):
    result = next((entry for entry in case["history"] if entry["revision"] == version), None)
    if result is None:
        raise HTTPException(404, "Investigation revision unavailable.")
    return result


@app.get("/cases/{case_id}/revisions/{previous}/diff/{current}", response_model=m.Comparison)
def diff(case_id: str, previous: int, current: int, owner: Owner):
    case = store.get(owner, case_id)
    before, after = get_revision(case, previous), get_revision(case, current)
    old = {item["id"]: item for item in before["findings"]}
    new = {item["id"]: item for item in after["findings"]}
    changes = [
        {"id": identifier, "before": old.get(identifier), "after": new.get(identifier)}
        for identifier in dict.fromkeys((*old, *new))
        if old.get(identifier) != new.get(identifier)
    ]
    return {
        "previous_revision": previous, "current_revision": current,
        "previous": before["scenario"], "current": after["scenario"], "changes": changes,
    }


@app.get("/cases/{case_id}/findings/{finding_id}", response_model=m.Flag)
def get_finding(case_id: str, finding_id: str, owner: Owner, revision: int | None = None):
    case = store.get(owner, case_id)
    findings = case["findings"] if revision is None else get_revision(case, revision)["findings"]
    result = next((item for item in findings if item["id"] == finding_id), None)
    if result is None:
        raise HTTPException(404, "Billing question unavailable.")
    return result



@app.post("/cases/{case_id}/india-review", response_model=PilotReview)
def india_review(case_id: str, data: PilotInput, owner: Owner):
    from ..api import check_revision

    for_local()
    case = store.get(owner, case_id)
    check_revision(case, data.revision)
    if case["sample"]:
        raise HTTPException(422, "India source review requires a non-sample case.")
    try:
        return review_case(case, data)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def assistance_case(case_id, data, owner):
    from ..api import check_revision

    case = store.get(owner, case_id)
    check_revision(case, data.revision)
    return case


@app.post("/cases/{case_id}/assistance/sample", response_model=m.AssistanceResult)
def sample_assistance(case_id: str, data: m.Version, owner: Owner):
    require_demo()
    case = assistance_case(case_id, data, owner)
    return screen_assistance(case, annual_household_income_paise=18_000_000, household_size=3)


@app.post("/cases/{case_id}/assistance", response_model=m.AssistanceResult)
def assistance(case_id: str, data: m.AssistanceInput, owner: Owner):
    for_local()
    require_demo()
    case = assistance_case(case_id, data, owner)
    # Screening inputs are processed in memory and excluded from documents, snapshots and logs.
    try:
        return screen_assistance(case, annual_household_income_paise=data.annual_household_income_paise,
                                 household_size=data.household_size)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/cases/{case_id}/drafts", response_model=m.Case)
def draft(case_id: str, data: m.DraftInput, owner: Owner, key: Key = None):
    from ..api import check_ready

    def apply(case):
        check_ready(case)
        if data.action not in case["drafts"]:
            generated = resolution.make_draft(case, data.action, allow_model=profile() == "local",
                                              patient_call=is_live_case(case))
            case["drafts"].pop(data.action, None)
            add_draft_version(case, data.action, generated)

    return mutate(owner, case_id, key, "draft", data, apply)


@app.patch("/cases/{case_id}/drafts/letter", response_model=m.Case)
def edit_letter(case_id: str, data: m.EditLetter, owner: Owner, key: Key = None):
    from ..api import check_ready

    for_local()

    def apply(case):
        check_ready(case)
        edit_draft(case, data.text)

    return mutate(owner, case_id, key, "edit_letter", data, apply)


@app.post("/cases/{case_id}/approvals", response_model=m.Case)
def approve(case_id: str, data: m.ApprovalInput, owner: Owner, key: Key = None):
    from ..api import exact_draft

    def apply(case):
        current = exact_draft(case, data)
        if data.action not in case["approvals"]:
            case["approvals"][data.action] = {**current, "approved_at": now()}
            event(case, f"{data.action.title()} approved", "The patient approved this revision's exact wording.", "Patient")

    return mutate(owner, case_id, key, "approve", data, apply)


@app.post("/cases/{case_id}/simulations", response_model=m.Case)
def simulate(case_id: str, data: m.Simulate, owner: Owner, key: Key = None):
    from ..api import exact_draft

    require_demo()

    def apply(case):
        current = exact_draft(case, data)
        simulated(case, current, data)

    return mutate(owner, case_id, key, "simulations", data, apply)


@app.get("/cases/{case_id}/packet", response_model=m.Packet, responses={200: {"content": {
    "application/pdf": {"schema": {"type": "string", "format": "binary"}},
}}})
def packet(case_id: str, revision: int, owner: Owner, preview: bool = False):
    from ..api import check_ready, check_revision

    case = store.get(owner, case_id)
    check_revision(case, revision)
    check_ready(case)
    try:
        lines, pdf = resolution.redacted_packet(case, approved_letter=case["approvals"].get("letter"),
                                                live_case=is_live_case(case))
    except resolution.RedactionError as exc:
        raise HTTPException(422, "The redacted packet could not pass the privacy check.") from exc
    if preview:
        return {"lines": lines}
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": "attachment; filename=FairBill-evidence.pdf",
    })
