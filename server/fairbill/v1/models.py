from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


GuestAmount = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000)]


class GuestCharge(Input):
    description: str = Field(min_length=1, max_length=72)
    units: int = Field(strict=True, ge=1, le=9999)
    amount: GuestAmount

    @field_validator("description")
    @classmethod
    def normalise_description(cls, value):
        result = " ".join(value.split())
        if not result:
            raise ValueError("Each charge needs a description.")
        return result


class GuestAdoption(Input):
    guest_id: UUID
    owner_id: UUID
    rows: list[GuestCharge] = Field(min_length=1, max_length=15)
    invoice_total: GuestAmount | None = None
    consent: Literal[True]

    @field_validator("consent", mode="before")
    @classmethod
    def explicit_consent(cls, value):
        if value is not True:
            raise ValueError("Explicit transfer consent is required.")
        return value


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


class HandoffInput(ApprovalInput):
    confirmed: Literal[True]

    @field_validator("confirmed", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("Confirm the device handoff.")
        return value


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


Status = Literal["open", "completed", "cancelled"]
DueDate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
Reference = Annotated[str, Field(max_length=100)]
Outcome = Annotated[str, Field(max_length=500)]


class FollowUp(BaseModel):
    id: str
    title: str
    due_on: DueDate
    status: Status
    reference: str = ""
    outcome: str = ""
    created_at: str
    updated_at: str


class DatedInput(Version):
    due_on: DueDate

    @field_validator("due_on")
    @classmethod
    def valid_date(cls, value):
        date.fromisoformat(value)
        return value


class CreateFollowUp(DatedInput):
    title: str = Field(min_length=1, max_length=100)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        title = " ".join(value.split())
        if not title:
            raise ValueError("Enter a follow-up title.")
        return title


class UpdateFollowUp(DatedInput):
    status: Status
    reference: Reference = ""
    outcome: Outcome = ""
    confirmed: Literal[True]

    @field_validator("confirmed", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("Confirm the follow-up change.")
        return value

    @model_validator(mode="after")
    def validate_outcome(self):
        self.reference = self.reference.strip()
        self.outcome = self.outcome.strip()
        if self.status == "completed" and not self.outcome:
            raise ValueError("Record the outcome before completing this follow-up.")
        if self.status == "open" and (self.reference or self.outcome):
            raise ValueError("Use a completed or cancelled status to record an outcome.")
        return self


class Case(BaseModel):
    id: str
    sample: bool
    revision: int
    documents: list[Document]
    findings: list[Flag]
    history: list[Investigation]
    follow_ups: list[FollowUp] = Field(default_factory=list)
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
