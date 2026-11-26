"""HTTPS entrypoint for the hosted API and public account pages."""

import json
import os
import re
import secrets
from contextlib import asynccontextmanager
from html import escape
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from .api import app as api

@asynccontextmanager
async def lifespan(_app):
    if os.getenv("FAIRBILL_PROFILE") != "hosted":
        raise RuntimeError("The public FairBill server requires FAIRBILL_PROFILE=hosted.")
    yield


app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None, lifespan=lifespan)
PAGE_ASSETS = Path(__file__).with_name("public_pages")


def page(title, body, *, script="", status=200):
    nonce = secrets.token_urlsafe(24)
    layout = (PAGE_ASSETS / "layout.html").read_text()
    html = layout.format(title=escape(title), nonce=nonce, body=body,
                         script=f'<script nonce="{nonce}">{script}</script>' if script else "")
    connect = os.getenv("FAIRBILL_SUPABASE_URL", "")
    if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", connect):
        connect = ""
    return HTMLResponse(html, status, headers={
        "Content-Security-Policy": f"default-src 'none'; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}'; "
                                   f"connect-src 'self' {connect}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    })


@app.get("/privacy")
def privacy():
    contact = os.getenv("FAIRBILL_PRIVACY_CONTACT", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", contact):
        return page("Privacy notice", "<p>The FairBill privacy notice is being prepared.</p>", status=503)
    notice = (PAGE_ASSETS / "privacy.html").read_text()
    return page("FairBill privacy notice", notice.format(contact=escape(contact)))


@app.get("/delete-account")
def delete_account_page():
    origin = os.getenv("FAIRBILL_SUPABASE_URL", "")
    key = os.getenv("FAIRBILL_SUPABASE_PUBLISHABLE_KEY", "")
    if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", origin) or not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
        return page("Delete your FairBill account", "<p>Account deletion is temporarily unavailable. Please try again later.</p>", status=503)
    body = (PAGE_ASSETS / "delete_account.html").read_text()
    script = f"const authOrigin = {json.dumps(origin)};\nconst authKey = {json.dumps(key)};\n"
    return page("Delete your FairBill account", body, script=script + (PAGE_ASSETS / "delete_account.js").read_text())


def patient_page(origin: str, publishable_key: str):
    body = (PAGE_ASSETS / "patient.html").read_text()
    config = f"const authOrigin = {json.dumps(origin)};\nconst authKey = {json.dumps(publishable_key)};\n"
    response = page("FairBill patient portal", body, script=config + (PAGE_ASSETS / "patient.js").read_text())
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    return response


@app.get("/patient")
def patient_portal():
    origin = os.getenv("FAIRBILL_SUPABASE_URL", "")
    key = os.getenv("FAIRBILL_SUPABASE_PUBLISHABLE_KEY", "")
    if (os.getenv("FAIRBILL_WEB_PATIENT") != "1"
            or not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", origin)
            or not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key)):
        result = page("FairBill patient portal", "<p>The patient portal is unavailable.</p>", status=404)
        result.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        return result
    return patient_page(origin, key)


app.mount("/", api)
