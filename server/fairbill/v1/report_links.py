"""Report links resolve only to a private, pinned case snapshot."""

import hashlib
import json
import os
import re
import secrets
import time
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from .. import resolution
from . import cloud, store
from .middleware import profile

PUBLIC_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
}
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}", re.ASCII)


def enabled() -> bool:
    return os.getenv("FAIRBILL_REPORT_SHARING") == "1" and profile() in {"local", "hosted"}


def missing():
    return HTTPException(404, "Report link unavailable.", PUBLIC_HEADERS)


def require_enabled():
    if not enabled():
        raise missing()


def _hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _stamp(epoch):
    return datetime.fromtimestamp(epoch, UTC) if epoch is not None else None


def _info(row, current_revision):
    ident, revision, expires, revoked = row
    status = ("revoked" if revoked is not None else "expired" if expires <= time.time()
              else "superseded" if revision != current_revision else "active")
    return {"id": ident, "revision": revision, "status": status,
            "expires_at": _stamp(expires), "revoked_at": _stamp(revoked)}


def _owner_result(result):
    status = result["status"]
    if status == "missing":
        raise HTTPException(404, "Case unavailable for this account.")
    if status == "inactive":
        raise HTTPException(403, "This account is being deleted.")
    if status == "key_conflict":
        raise HTTPException(409, "This link was already created. Check your links and revoke it if needed.")
    if status == "limit":
        raise HTTPException(409, "Revoke an active link before creating another.")
    if status != "ok":
        raise HTTPException(409, "Refresh the case and review the current packet before creating a link.")
    return result


def create(owner, case_id, revision, hours, key):
    if not key:
        raise HTTPException(400, "An idempotency key is required to create a report link.")
    token = secrets.token_urlsafe(32)
    digest = _hash(token)
    if profile() == "hosted":
        result = _owner_result(cloud.rpc(
            "create_report_link", p_owner=owner, p_case=cloud.case_uuid(case_id),
            p_revision=revision, p_hours=hours, p_key=key, p_hash=digest,
        ))
        return {"link": result["link"], "token": token}

    with store.connection() as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        serial, raw = store.select_case(conn, owner, case_id)
        case = json.loads(raw)
        if case["sample"] or case["revision"] != revision or case["investigated_revision"] != revision:
            _owner_result({"status": "case_conflict"})
        if conn.execute("SELECT 1 FROM report_links WHERE case_id = ? AND creation_key = ?",
                        (case_id, key)).fetchone():
            _owner_result({"status": "key_conflict"})
        now = int(time.time())
        active = conn.execute(
            "SELECT count(*) FROM report_links WHERE case_id = ? AND revision = ? "
            "AND expires_at > ? AND revoked_at IS NULL", (case_id, revision, now),
        ).fetchone()[0]
        if active >= 10:
            _owner_result({"status": "limit"})
        ident, expires = str(uuid4()), now + hours * 3600
        conn.execute(
            "INSERT INTO report_links (id, case_id, revision, serial, token_hash, creation_key, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)", (ident, case_id, revision, serial, digest, key, expires),
        )
        return {"link": _info((ident, revision, expires, None), revision), "token": token}


def listing(owner, case_id):
    if profile() == "hosted":
        return _owner_result(cloud.rpc("list_report_links", p_owner=owner, p_case=cloud.case_uuid(case_id)))["links"]

    with store.connection() as conn:
        _, raw = store.select_case(conn, owner, case_id)
        revision = json.loads(raw)["revision"]
        stamp = int(time.time())
        rows = conn.execute(
            "SELECT id, revision, expires_at, revoked_at FROM report_links WHERE case_id = ? "
            "ORDER BY (revision = ? AND expires_at > ? AND revoked_at IS NULL) DESC, expires_at DESC, id LIMIT 50",
            (case_id, revision, stamp),
        ).fetchall()
    return [_info(row, revision) for row in rows]


def revoke(owner, case_id, link_id):
    if profile() == "hosted":
        found = cloud.rpc("revoke_report_link", p_owner=owner, p_case=cloud.case_uuid(case_id), p_link=link_id)
    else:
        with store.connection() as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            store.select_case(conn, owner, case_id)
            found = conn.execute(
                "UPDATE report_links SET revoked_at = coalesce(revoked_at, ?) WHERE case_id = ? AND id = ?",
                (int(time.time()), case_id, link_id),
            ).rowcount > 0
    if not found:
        raise missing()


def _resolve(digest, check_only=False):
    if profile() == "hosted":
        return cloud.rpc("resolve_report_link", p_hash=digest, p_check_only=check_only)

    with store.connection() as conn:
        value = "1" if check_only else "pinned.snapshot"
        row = conn.execute(
            f"SELECT {value} FROM report_links link JOIN cases current ON current.id = link.case_id "
            "JOIN case_snapshots_v1 pinned ON pinned.case_id = link.case_id AND pinned.serial = link.serial "
            "WHERE link.token_hash = ? AND link.revoked_at IS NULL AND link.expires_at > ? "
            "AND json_extract(current.snapshot, '$.revision') = link.revision "
            "AND json_extract(pinned.snapshot, '$.revision') = link.revision "
            "AND json_extract(pinned.snapshot, '$.investigated_revision') = link.revision",
            (digest, int(time.time())),
        ).fetchone()
    return bool(row) if check_only else (json.loads(row[0]) if row else None)


def download(token):
    if not token or TOKEN.fullmatch(token) is None:
        raise missing()
    digest = _hash(token)
    snapshot = _resolve(digest)
    if snapshot is None:
        raise missing()
    # Public exports must never include a raw excerpt, even from a bundled document.
    snapshot["documents"] = [{**doc, "bundled": False} for doc in snapshot["documents"]]
    try:
        _, packet = resolution.redacted_packet(snapshot, live_case=True)
    except resolution.RedactionError:
        raise missing() from None
    # Recheck after rendering, so a revoke, expiry, edit or deletion during rendering wins.
    if _resolve(digest, check_only=True) is not True:
        raise missing()
    return packet
