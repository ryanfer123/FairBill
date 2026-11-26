from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..documents import Kind, ObservedRow

Paise = Annotated[int, Field(strict=True)]
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
Action = Literal["letter", "call"]
Mode = Literal["Offline", "Gemini"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Error(BaseModel):
    code: str
    message: str
    details: list[dict[str, str]] = []


class Create(Input):
    sample: bool | None = None


class Version(Input):
    revision: int = Field(strict=True, ge=1)


class ReportLinkInput(Version):
    consent: Literal[True]
    hours: int = Field(strict=True, ge=1, le=168)

    @field_validator("consent", mode="before")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("Explicit consent is required.")
        return value


class ReportLink(BaseModel):
    id: str
    revision: int
    expires_at: datetime
    revoked_at: datetime | None = None
    status: Literal["active", "revoked", "expired", "superseded"]


class CreatedReportLink(BaseModel):
    link: ReportLink
    token: str


class PolicyLookupInput(Version):
    hospital: str = Field(max_length=48, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class Paste(Version):
    kind: Kind
    text: str = Field(min_length=1, max_length=20_000)


class Confirm(Version):
    rows: list[ObservedRow] | None = Field(default=None, min_length=1, max_length=150)


class UploadVersion(Version):
    kind: Kind
    sha256: Hash
    media_type: str | None = None
    device_ocr_sha256: Hash | None = Field(default=None, exclude_if=lambda value: value is None)


class EditRow(Version):
    row: ObservedRow


class Received(Version):
    received: bool | None


class DraftInput(Version):
    action: Action


class EditLetter(Version):
    text: str = Field(min_length=1, max_length=18_000)


class ApprovalInput(DraftInput):
    hash: Hash


class Simulate(ApprovalInput):
    step: Literal["start", "identity", "identity_failed", "activate", "finish"] = "start"


class AssistanceInput(Version):
    annual_household_income_paise: Paise = Field(ge=0, le=10**12)
    household_size: int = Field(strict=True, ge=1, le=30)


class Source(BaseModel):
    document_id: str
    document_kind: str
    sha256: Hash
    row_id: str
    page: int
    line: int
    quote: str
    relation: str
    basis: str


class Flag(BaseModel):
    id: str
    check: str
    title: str
    explanation: str
    amount: Paise | None
    status: Literal["active", "withdrawn", "linked"]
    adjustment: bool
    exposure: list[str] | None = None
    evidence: list[Source]
    kind: Literal["billing_question"] = "billing_question"
    rule_id: str | None = None
    severity: str | None = None


class ExtractedLine(BaseModel):
    id: str
    page: int
    line: int
    raw_text: str
    bbox: tuple[int, int, int, int] | None = None
    confidence: int | None = None
    source: str
    needs_manual_entry: bool


class Document(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    kind: Kind
    pages: list[str]
    rows: list[ObservedRow]
    notes: list[str]
    sha256: Hash
    confirmed: bool
    edited_rows: list[str] = []
    extracted_lines: list[ExtractedLine] = []
    media_type: str | None = None


class Scenario(BaseModel):
    billed: Paise | None
    reconciled: bool
    adjustments: Paise | None
    conditional: Paise | None
    unresolved_deduction: Paise | None
    included: list[str]
    sources: dict[str, list[Source]] = {}


class Investigation(BaseModel):
    revision: int
    scenario: Scenario
    findings: list[Flag]
    at: str


class Event(BaseModel):
    id: int
    revision: int
    title: str
    detail: str
    role: str
    at: str


class Draft(BaseModel):
    action: Action
    revision: int
    hash: Hash
    mode: Mode
    text: str
    simulated: bool = True
    version: int = 1
    at: str | None = None
    fallback_reason: str | None = None


class Approval(Draft):
    approved_at: str | None = None


class Turn(BaseModel):
    speaker: Literal["system", "patient", "advocate", "billing"]
    text: str
    at: str
    simulated: Literal[True] = True


class Receipt(BaseModel):
    action: Action
    revision: int
    id: str
    state: str
    simulated: Literal[True] = True
    progress: Literal["IDLE", "IDENTITY_PENDING", "IDENTITY_VERIFIED", "ADVOCATE_ACTIVE", "ENDED"] | None = None
    outcome: str | None = None
    attempts: int = 0
    hash: Hash | None = None
    at: str | None = None
    channel: str | None = None
    turns: list[Turn] = []


class Case(BaseModel):
    id: str
    sample: bool
    revision: int
    documents: list[Document]
    findings: list[Flag]
    history: list[Investigation]
    timeline: list[Event]
    scenario: Scenario | None
    agent_mode: Mode | None
    investigated_revision: int | None
    pending: list[str]
    drafts: dict[Action, Draft]
    approvals: dict[Action, Approval]
    receipts: dict[str, Receipt]
    draft_history: list[Draft] = []


class CaseSummary(BaseModel):
    id: str
    sample: bool
    revision: int
    investigated_revision: int | None


class CasePage(BaseModel):
    cases: list[CaseSummary]
    next_after: str | None = None


class FindingChange(BaseModel):
    id: str
    before: Flag | None
    after: Flag | None


class Comparison(BaseModel):
    previous_revision: int
    current_revision: int
    previous: Scenario
    current: Scenario
    changes: list[FindingChange]


class AssistanceFinding(BaseModel):
    id: str
    title: str
    explanation: str
    status: str
    source: Source


class AssistanceResult(BaseModel):
    policy_id: str
    simulated: Literal[True]
    findings: list[AssistanceFinding]


class Packet(BaseModel):
    lines: list[str]


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    demo: Literal["synthetic"] | None = None
    profile: Literal["local", "fixtures", "hosted"]
    mode: Mode
    ocr_available: bool
    db: Literal["ok", "unavailable"]
