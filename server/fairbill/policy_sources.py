"""Read registered hospital assistance pages without sending case data to them."""

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Literal

import httpx
from pydantic import BaseModel

MAX_BYTES = 512 * 1024
DEADLINE = 8
MAX_REDIRECTS = 2
REDIRECTS = {301, 302, 303, 307, 308}


class PolicySource(BaseModel):
    id: str
    hospital: str
    title: str
    url: str
    section: str
    next_step: str


class PolicyLookup(BaseModel):
    revision: int
    status: Literal["verified", "failed", "unsupported", "stale"]
    checked_at: datetime
    source: PolicySource | None = None
    excerpt: str | None = None


@dataclass(frozen=True)
class RegisteredSource:
    source: PolicySource
    excerpt: str
    redirect_urls: tuple[str, ...] = ()
    preceding_text: str = ""


_RP_PAGE = "/index.php/en/2023-07-19-08-55-03"
SOURCES = (
    RegisteredSource(
        source=PolicySource(
            id="aiims-delhi-rpc",
            hospital="AIIMS New Delhi, R.P. Centre",
            title="Patient Welfare Services",
            url="https://aiims.edu" + _RP_PAGE,
            section="Exemption of Hospital Levy charges for BPL and Indigent patients",
            next_step="Ask the R.P. Centre Medical Social Welfare Unit about its assessment and the documents to bring.",
        ),
        excerpt="Medical Social Welfare Unit exempts the hospital charges manually and through e- hospital management system based on the Socio-economic assessment.",
        redirect_urls=("https://www.aiims.edu" + _RP_PAGE,),
    ),
    RegisteredSource(
        source=PolicySource(
            id="mpmmcc-varanasi",
            hospital="MPMMCC, Varanasi",
            title="Medical Social Services",
            url="https://mpmmcc.tmc.gov.in/departments/medical-social-works",
            section="The services provided by the department include:",
            next_step="Ask the Medical Social Services department about an assessment and the relevant welfare schemes.",
        ),
        excerpt="Patient assessment and slotting for different welfare schemes for financial assistance.",
        preceding_text="Advocacy & networking.",
    ),
)


class SourceUnavailable(Exception):
    pass


class VisibleText(HTMLParser):
    """Collect text without loading assets, executing code, or following document links."""

    _ignore = {"head", "script", "style", "template", "noscript", "svg", "iframe", "nav", "footer"}
    _blocks = {"h1", "h2", "h3", "h4", "h5", "h6", "div", "br", "p", "li", "td", "th", "section", "article"}
    _void = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
             "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored: str | None = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if self.ignored:
            if self.ignored == tag:
                self.depth += 1
            return
        attributes = dict(attrs)
        style = re.sub(r"\s+", "", (attributes.get("style") or "").casefold())
        hidden = "hidden" in attributes or attributes.get("aria-hidden") == "true" or "display:none" in style
        if tag in self._ignore or (hidden and tag not in self._void):
            self.ignored, self.depth = tag, 1
        elif tag in self._blocks:
            self.parts.append(" ")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.ignored:
            if self.ignored == tag:
                self.depth -= 1
                if not self.depth:
                    self.ignored = None
        elif tag in self._blocks:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def _verified_excerpt(markup: bytes, entry: RegisteredSource) -> bool:
    parser = VisibleText()
    try:
        parser.feed(markup.decode("utf-8", errors="replace"))
        parser.close()
    except AssertionError as exc:
        raise SourceUnavailable() from exc
    visible = " ".join("".join(parser.parts).split())
    approved = " ".join(filter(None, (entry.source.section, entry.preceding_text, entry.excerpt)))
    return approved in visible


async def _public_ip(host: str) -> str:
    records = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    addresses = [ipaddress.ip_address(record[4][0]) for record in records]
    if not addresses or any(not ip.is_global or ip.is_multicast or ip.is_reserved for ip in addresses):
        raise SourceUnavailable()
    return str(min(addresses, key=lambda ip: ip.version))


async def _fetch(entry: RegisteredSource) -> tuple[bytes, str]:
    approved = (entry.source.url, *entry.redirect_urls)
    target = httpx.URL(entry.source.url)
    limits = httpx.Limits(max_keepalive_connections=0)
    async with asyncio.timeout(DEADLINE), httpx.AsyncClient(
        timeout=4, follow_redirects=False, trust_env=False, limits=limits,
    ) as client:
        for hop in range(MAX_REDIRECTS + 1):
            if (str(target) not in approved or target.scheme != "https" or not target.host
                    or target.port not in (None, 443) or target.userinfo or target.fragment or target.query):
                raise SourceUnavailable()
            # Pin this request to the validated address. TLS still authenticates the registered hostname.
            address = await _public_ip(target.host)
            pinned = target.copy_with(host=address)
            request = client.build_request(
                "GET", pinned, headers={
                    "Host": target.host, "Accept": "text/html", "Accept-Encoding": "identity",
                    "User-Agent": "FairBill-PolicyLookup/1.0",
                },
                extensions={"sni_hostname": target.host},
            )
            request.headers.pop("Cookie", None)
            response = await client.send(request, stream=True)
            try:
                if response.status_code in REDIRECTS:
                    location = response.headers.get("location")
                    if not location or hop == MAX_REDIRECTS:
                        raise SourceUnavailable()
                    target = target.join(location)
                    continue
                media = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                encoding = response.headers.get("content-encoding", "identity").lower().strip()
                length = response.headers.get("content-length", "")
                if (response.status_code != 200 or media != "text/html" or encoding != "identity"
                        or (length.isdecimal() and (len(length) > 9 or int(length) > MAX_BYTES))):
                    raise SourceUnavailable()
                body = bytearray()
                async for chunk in response.aiter_raw():
                    if len(body) + len(chunk) > MAX_BYTES:
                        raise SourceUnavailable()
                    body.extend(chunk)
                return bytes(body), str(target)
            finally:
                await response.aclose()
    raise SourceUnavailable()


async def lookup(hospital: str, revision: int) -> PolicyLookup:
    entry = next((entry for entry in SOURCES if entry.source.id == hospital), None)
    if entry is None:
        return PolicyLookup(revision=revision, status="unsupported", checked_at=datetime.now(UTC))
    try:
        markup, url = await _fetch(entry)
        verified = _verified_excerpt(markup, entry)
    except (SourceUnavailable, TimeoutError, OSError, httpx.HTTPError, httpx.InvalidURL, ValueError):
        return PolicyLookup(revision=revision, status="failed", checked_at=datetime.now(UTC), source=entry.source)
    return PolicyLookup(
        revision=revision, status="verified" if verified else "stale", checked_at=datetime.now(UTC),
        source=entry.source.model_copy(update={"url": url}), excerpt=entry.excerpt if verified else None,
    )
