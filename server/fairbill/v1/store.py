import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

from fastapi import HTTPException

from . import cloud
from .middleware import profile

SCHEMA = Path(__file__).with_name("schema.sql").read_text()
REPLAY_TTL = 86400


@contextmanager
def connection():
    path = Path(os.getenv("FAIRBILL_DB", "../.local/fairbill.sqlite3")).expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    conn = sqlite3.connect(path, timeout=8)
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        if conn.execute("PRAGMA table_info(fairbill_schema_migrations)").fetchone() is None:
            with conn:
                conn.executescript(SCHEMA)
        yield conn
    finally:
        conn.close()


def health():
    if profile() == "hosted":
        return cloud.health()
    with connection() as conn:
        conn.execute("SELECT 1").fetchone()


def select_case(conn, owner, case_id):
    result = conn.execute("SELECT serial, snapshot FROM cases WHERE id = ? AND owner = ?", (case_id, owner)).fetchone()
    if result is None:
        raise HTTPException(404, "Case unavailable for this installation.")
    return result


def get(owner, case_id):
    if profile() == "hosted":
        return cloud.get(owner, case_id)
    with connection() as conn:
        return json.loads(select_case(conn, owner, case_id)[1])


def list_cases(owner, limit, after):
    if profile() == "hosted":
        return cloud.list_cases(owner, limit, after)
    with connection() as conn:
        rows = conn.execute(
            "SELECT snapshot FROM cases WHERE owner = ? AND id > ? ORDER BY id LIMIT ?", (owner, after, limit + 1)
        ).fetchall()
    items = [json.loads(row[0]) for row in rows[:limit]]
    return {"cases": items, "next_after": items[-1]["id"] if len(rows) > limit else None}


def replay(conn, owner, key, fingerprint):
    if not key:
        return None
    result = conn.execute(
        "SELECT fingerprint, response FROM request_replays_v1 WHERE owner = ? AND key = ? AND created_at >= ?",
        (owner, key, int(time.time()) - REPLAY_TTL),
    ).fetchone()
    if result is None:
        return None
    if result[0] != fingerprint:
        raise HTTPException(409, "This idempotency key has already been used for a different request.")
    return json.loads(result[1])


def mutate(owner: str, key: str | None, reason: str, payload: dict, apply: Callable,
           case_id: str | None = None, *, persist: Callable | None = None):
    fingerprint = hashlib.sha256(
        json.dumps([reason, case_id, payload], sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    if profile() == "hosted":
        return cloud.mutate(owner, key, reason, fingerprint, apply, case_id, persist)
    with connection() as conn:
        previous = replay(conn, owner, key, fingerprint)
        if previous is not None:
            return previous
        original = select_case(conn, owner, case_id) if case_id else None
    result = apply(json.loads(original[1])) if original else apply()
    result_json = json.dumps(result)
    with connection() as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        previous = replay(conn, owner, key, fingerprint)
        if previous is not None:
            return previous
        if original:
            serial, snapshot = original
            write = conn.execute(
                "UPDATE cases SET serial = serial + 1, snapshot = ? WHERE id = ? AND owner = ? AND serial = ?",
                (result_json, case_id, owner, serial),
            )
            if not write.rowcount:
                raise HTTPException(409, "The case changed. Refresh and try again.")
            conn.execute(
                "INSERT OR IGNORE INTO case_snapshots_v1 VALUES (?, ?, ?, ?)", (case_id, serial, "source_state", snapshot)
            )
            next_serial = serial + 1
        else:
            next_serial = 0
            conn.execute("INSERT INTO cases VALUES (?, ?, ?, ?)", (result["id"], owner, next_serial, result_json))
        conn.execute("INSERT INTO case_snapshots_v1 VALUES (?, ?, ?, ?)", (result["id"], next_serial, reason, result_json))
        if key:
            stamp = int(time.time())
            conn.execute("DELETE FROM request_replays_v1 WHERE created_at < ?", (stamp - REPLAY_TTL,))
            conn.execute("INSERT INTO request_replays_v1 VALUES (?, ?, ?, ?, ?)", (owner, key, fingerprint, result_json, stamp))
        if persist is not None:
            persist()
    return result
