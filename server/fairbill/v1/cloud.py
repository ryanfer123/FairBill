"""Supabase transport for authenticated cases and private original files."""

import base64
import json
import os
import re
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import HTTPException

BUCKET = "fairbill-originals"
client = httpx.Client(timeout=httpx.Timeout(15, connect=5), trust_env=False)


class Unavailable(OSError):
    """A hosted dependency did not confirm the result."""


def setting(name):
    value = os.getenv(f"FAIRBILL_SUPABASE_{name}", "").strip()
    if not value:
        raise Unavailable("Missing Supabase configuration.")
    return value


def request(method, path, *, token=None, privileged=True, **kwargs):
    base = setting("URL").rstrip("/")
    target = urlparse(base)
    if target.scheme != "https" or not target.hostname or target.username or target.path or target.query or target.fragment:
        raise Unavailable("Invalid Supabase origin.")
    key = setting("SERVICE_KEY" if privileged else "PUBLISHABLE_KEY")
    headers = {"apikey": key, **kwargs.pop("headers", {})}
    bearer = token or (key if key.startswith("eyJ") else None)
    if bearer is not None:
        headers["Authorization"] = f"Bearer {bearer}"
    try:
        return client.request(method, base + path, headers=headers, **kwargs)
    except httpx.RequestError:
        raise Unavailable("Supabase request failed.") from None


def checked(response):
    if not response.is_success:
        raise Unavailable("Supabase rejected the request.")
    return response


def body(response):
    try:
        return checked(response).json()
    except ValueError:
        raise Unavailable("Supabase returned an invalid response.") from None


def rpc(name, **payload):
    return body(request("POST", f"/rest/v1/rpc/fairbill_{name}", json=payload))


def unauthorized():
    return HTTPException(401, "Sign in to FairBill to continue.", {"WWW-Authenticate": "Bearer"})


def authenticate(token):
    if len(token) > 8192 or not re.fullmatch(r"[\w-]+\.[\w-]+\.[\w-]+", token, re.ASCII):
        raise unauthorized()
    response = request("GET", "/auth/v1/user", token=token, privileged=False)
    if response.status_code in (401, 403, 404):
        raise unauthorized()
    user = body(response)
    try:
        owner = str(UUID(user["id"]))
        # Auth already verified this token. The session record also needs to still exist.
        encoded = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        session = str(UUID(claims["session_id"]))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise unauthorized() from None
    if user.get("is_anonymous") or claims.get("sub") != owner:
        raise unauthorized()
    if rpc("validate_session", p_owner=owner, p_session=session) is not True:
        raise unauthorized()
    return owner


def health():
    setting("PUBLISHABLE_KEY")
    status = rpc("hosted_state", p_owner="00000000-0000-0000-0000-000000000000", p_case=None, p_key=None)
    if not isinstance(status, dict) or status.get("status") != "inactive":
        raise Unavailable("Unexpected hosted status.")


def case_uuid(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(404, "Case unavailable for this account.") from None


def state(owner, case_id=None, key=None):
    result = rpc("hosted_state", p_owner=owner, p_case=case_uuid(case_id) if case_id else None, p_key=key)
    if result["status"] == "inactive":
        raise HTTPException(403, "This account is being deleted.")
    return result


def get(owner, case_id):
    current = state(owner, case_id)["current"]
    if current is None:
        raise HTTPException(404, "Case unavailable for this account.")
    return current["snapshot"]


def list_cases(owner, limit, after):
    state(owner)
    params = {"select": "snapshot", "owner_id": f"eq.{owner}", "order": "id.asc", "limit": limit + 1}
    if after:
        params["id"] = f"gt.{case_uuid(after)}"
    rows = body(request("GET", "/rest/v1/fairbill_cases", params=params))
    items = [row["snapshot"] for row in rows[:limit]]
    return {"cases": items, "next_after": items[-1]["id"] if len(rows) > limit else None}


def stage_original(owner, case_id, document, data, token):
    doc_id = document["id"]
    if rpc("reserve_original", p_owner=owner, p_case=case_id, p_document=doc_id) is not True:
        raise HTTPException(409, "The case changed. Refresh and try again.")
    name = f"{owner}/{case_id}/{doc_id}"
    try:
        checked(request("POST", f"/storage/v1/object/{BUCKET}/{name}", token=token, privileged=False,
                        files={"file": (doc_id, data, document["media_type"])}, headers={"x-upsert": "false"}))
    except Unavailable:
        abandon_original(owner, name)
        raise
    return name


def remove_originals(names):
    checked(request("DELETE", f"/storage/v1/object/{BUCKET}", json={"prefixes": names}))


def abandon_original(owner, name):
    # Wait for any concurrent Storage transaction before removing the uncommitted object.
    if rpc("cancel_original", p_owner=owner, p_object=name) is True:
        remove_originals([name])


def mutate(owner, key, reason, fingerprint, apply, case_id, persist):
    initial = state(owner, case_id, key)
    previous = initial["replay"]
    if previous:
        if previous["fingerprint"] != fingerprint:
            raise HTTPException(409, "This idempotency key has already been used for a different request.")
        return previous["response"]
    original = initial["current"]
    if case_id and original is None:
        raise HTTPException(404, "Case unavailable for this account.")
    result = apply(original["snapshot"]) if original else apply()
    upload = persist() if persist else None
    committed = rpc("commit_case", p_owner=owner, p_case=result["id"], p_expected=original["serial"] if original else None,
                    p_key=key, p_fingerprint=fingerprint, p_reason=reason, p_snapshot=result, p_original=upload)
    status = committed["status"]
    # An ambiguous commit response must leave the original in place. A retry can read the successful replay.
    if upload and status != "ok":
        abandon_original(owner, upload)
    if status in ("ok", "replay"):
        return committed["snapshot"]
    match status:
        case "case_conflict":
            raise HTTPException(409, "The case changed. Refresh and try again.")
        case "key_conflict":
            raise HTTPException(409, "This idempotency key has already been used for a different request.")
        case "missing":
            raise HTTPException(404, "Case unavailable for this account.")
        case "inactive":
            raise HTTPException(403, "This account is being deleted.")
        case _:
            raise Unavailable("The hosted case was not committed.")


def delete_account(owner):
    path = f"/auth/v1/admin/users/{owner}"
    # Bound each request. A retry continues after any completed batch.
    for _ in range(10):
        names = rpc("account_originals_for_deletion", p_owner=owner)
        if not names:
            response = request("DELETE", path, json={"should_soft_delete": False})
            if response.status_code != 404:
                checked(response)
            return
        remove_originals(names)
    raise Unavailable("Account deletion is still in progress.")
