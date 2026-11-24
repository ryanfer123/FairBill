import json
import logging
import os
import re
import threading
import time
from collections import deque
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from ..documents import MAX_BYTES

LOG = logging.getLogger("uvicorn.error")
MAX_BODY = MAX_BYTES + 65_536
WINDOW = 60
LIMIT = 120


def profile() -> str:
    value = os.getenv("FAIRBILL_PROFILE", "local")
    return "local" if value == "local" else "fixtures"


def error(status: int, code: str, message: str, details=None, headers=None):
    return JSONResponse(
        {"code": code, "message": message, "details": details or []},
        status_code=status,
        headers=headers,
    )


def route_error(status: int, detail: str, headers=None):
    codes = {
        400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
        405: "method_not_allowed", 409: "conflict", 413: "too_large", 422: "validation_error",
        429: "rate_limited", 503: "unavailable",
    }
    return error(status, codes.get(status, "request_failed"), detail, headers=headers)


class RequestContext:
    def __init__(self, app):
        self.app = app
        self.clients = {}
        self.lock = threading.Lock()
        self.last_prune = time.monotonic()

    def allowed(self, client: str) -> bool:
        configured = os.getenv("FAIRBILL_REQUESTS_PER_MINUTE", str(LIMIT))
        limit = min(10_000, max(1, int(configured))) if configured.isdecimal() and len(configured) <= 5 else LIMIT
        now = time.monotonic()
        with self.lock:
            if now - self.last_prune >= WINDOW:
                self.clients = {
                    host: calls for host, calls in self.clients.items()
                    if calls and now - calls[-1] < WINDOW
                }
                self.last_prune = now
            if client not in self.clients and len(self.clients) >= 2048:
                return False
            calls = self.clients.setdefault(client, deque())
            while calls and now - calls[0] >= WINDOW:
                calls.popleft()
            if len(calls) >= limit:
                return False
            calls.append(now)
            return True

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_id = headers.get("x-request-id") or uuid4().hex
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", request_id):
            request_id = uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        length = headers.get("content-length")
        client = (scope.get("client") or ("unknown",))[0]
        start = time.monotonic()
        method = scope["method"]
        size = 0

        async def bounded_receive():
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > MAX_BODY:
                raise HTTPException(413, "The request body is too large.")
            return message

        async def write(message):
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers["X-Request-ID"] = request_id
                response_headers.setdefault("Cache-Control", "no-store")
                route = scope.get("route")
                route_path = getattr(route, "path", "unmatched")
                LOG.info("%s", json.dumps({
                    "event": "http_request", "request_id": request_id, "method": method,
                    "route": route_path, "status": message["status"],
                    "elapsed_ms": int((time.monotonic() - start) * 1000),
                }, separators=(",", ":")))
            await send(message)

        if length is not None and (not length.isdecimal() or len(length) > 12):
            await route_error(400, "Invalid request body length.")(scope, receive, write)
        elif length is not None and int(length) > MAX_BODY:
            await route_error(413, "The request body is too large.")(scope, receive, write)
        elif profile() == "fixtures" and not scope["path"].endswith("/health") and not self.allowed(client):
            await route_error(429, "Too many requests. Retry in a minute.", {"Retry-After": "60"})(scope, receive, write)
        else:
            await self.app(scope, bounded_receive, write)
