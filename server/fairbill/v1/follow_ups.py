"""Patient-owned follow-up records. State changes never initiate contact."""

from uuid import uuid4

from fastapi import HTTPException

from ..investigation import event, now
from .models import CreateFollowUp, FollowUp, UpdateFollowUp

def create(case, data: CreateFollowUp):
    if case["sample"]:
        raise HTTPException(422, "Follow-ups require a non-sample case.")
    saved = case.setdefault("follow_ups", [])
    if len(saved) >= 100:
        raise HTTPException(409, "This case has reached its follow-up limit.")
    stamp = now()
    saved.append(FollowUp(id=str(uuid4()), title=data.title, due_on=data.due_on, status="open",
                          created_at=stamp, updated_at=stamp).model_dump())
    event(case, "Follow-up added", "You saved a follow-up date.", "Patient")


def update(case, ident, data: UpdateFollowUp):
    saved = next((entry for entry in case.get("follow_ups", []) if entry["id"] == ident), None)
    if saved is None:
        raise HTTPException(404, "Follow-up unavailable.")
    changed = data.model_dump(include={"due_on", "status", "reference", "outcome"})
    if all(saved[key] == value for key, value in changed.items()):
        return
    saved.update(changed, updated_at=now())
    event(case, "Follow-up updated", f"You marked a follow-up as {data.status}.", "Patient")
