import asyncio
import socket

import httpx
import pytest
from fastapi.testclient import TestClient

from fairbill import policy_sources as policies
from fairbill.api import app
from fairbill.v1 import store

AUTH = {"Authorization": f"Bearer {'a' * 64}"}
OTHER = {"Authorization": f"Bearer {'b' * 64}"}
AIIMS, VARANASI = policies.SOURCES
PUBLIC_IP = "93.184.216.34"


def page(entry, *, excerpt=True):
    quote = f"<p>{entry.excerpt}</p>" if excerpt else f"<script>{entry.excerpt}</script>"
    return f"<html><h2>{entry.source.section}</h2><p>{entry.preceding_text}</p>{quote}</html>".encode()


def response(markup, **headers):
    return httpx.Response(200, headers={"content-type": "text/html", **headers}, stream=httpx.ByteStream(markup))


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("FAIRBILL_PROFILE", "local")
    monkeypatch.setenv("FAIRBILL_DB", str(tmp_path / "policy.db"))
    with TestClient(app, headers=AUTH, client=(tmp_path.name, 50000)) as client:
        created = client.post("/v1/cases", json={"sample": False})
        assert created.status_code == 201
        yield client, f"/v1/cases/{created.json()['id']}/assistance/policy-lookup"


@pytest.fixture
def public_transport(monkeypatch):
    real_client = httpx.AsyncClient

    async def resolve(host):
        assert host in {"aiims.edu", "www.aiims.edu", "mpmmcc.tmc.gov.in"}
        return PUBLIC_IP

    monkeypatch.setattr(policies, "_public_ip", resolve)

    def start(handler):
        def create_client(**kwargs):
            assert kwargs["trust_env"] is False and kwargs["follow_redirects"] is False
            return real_client(transport=httpx.MockTransport(handler), **kwargs)

        monkeypatch.setattr(policies.httpx, "AsyncClient", create_client)

    return start


def test_catalog_and_patient_case_return_verified_source_without_disclosing_case(api, public_transport):
    client, path = api
    calls = []

    def upstream(request):
        calls.append(request)
        assert request.method == "GET"
        assert request.url.host == PUBLIC_IP
        assert request.url.query == b""
        assert request.url.path == httpx.URL(AIIMS.source.url).path
        assert request.headers["host"] == request.extensions["sni_hostname"] == "aiims.edu"
        assert request.content == b""
        assert not {"authorization", "cookie", "referer", "idempotency-key", "x-request-id"} & set(request.headers)
        return response(page(AIIMS))

    public_transport(upstream)
    catalog = client.get("/v1/assistance/policy-sources")
    assert catalog.status_code == 200 and catalog.headers["cache-control"] == "no-store"
    assert [entry["id"] for entry in catalog.json()] == [AIIMS.source.id, VARANASI.source.id]
    assert calls == []
    case_path = path.removesuffix("/assistance/policy-lookup")
    imported = client.post(case_path + "/documents/text", headers={"Idempotency-Key": "fictional-source"}, json={
        "revision": 1, "kind": "invoice",
        "text": "Patient name: Fictional Fixture\nEmail: testing@example.invalid\nTOTAL|T|Payable|740",
    })
    assert imported.status_code == 200
    revision = imported.json()["revision"]
    result = client.post(path, json={"hospital": AIIMS.source.id, "revision": revision})
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    assert len(calls) == 1
    payload = result.json()
    assert payload["status"] == "verified" and payload["revision"] == revision
    assert payload["checked_at"].endswith("Z")
    assert payload["source"]["url"] == AIIMS.source.url
    assert payload["source"]["section"] == AIIMS.source.section
    assert payload["excerpt"] == AIIMS.excerpt


def test_unsupported_private_fields_and_wrong_revision_never_fetch(api, public_transport):
    client, path = api

    def forbidden(_):
        pytest.fail("Unexpected request to a hospital")

    public_transport(forbidden)
    unknown = client.post(path, json={"hospital": "other", "revision": 1}).json()
    assert unknown["status"] == "unsupported" and unknown["source"] is None and unknown["excerpt"] is None
    known = {"hospital": AIIMS.source.id, "revision": 1}
    assert client.post(path, json={**known, "revision": 2}).status_code == 409
    assert client.post(path, json=known, headers=OTHER).status_code == 404
    assert client.post(path, json={**known, "hospital": "https://example.invalid/"}).status_code == 422
    for field in ("url", "income", "case_id", "ocr_text", "name", "authorization"):
        assert client.post(path, json={**known, field: "synthetic-private"}).status_code == 422


def test_case_revision_is_rechecked_after_fetch(api, public_transport, monkeypatch):
    client, path = api
    original = store.get
    calls = 0

    def changed(owner, case_id):
        nonlocal calls
        calls += 1
        case = original(owner, case_id)
        return case if calls == 1 else {**case, "revision": 2}

    monkeypatch.setattr(store, "get", changed)
    public_transport(lambda _: response(page(VARANASI)))
    result = client.post(path, json={"hospital": VARANASI.source.id, "revision": 1})
    assert calls == 2
    assert result.status_code == 409 and VARANASI.excerpt not in result.text


@pytest.mark.parametrize("markup", ["changed", "script", "hidden", "wrong-section"])
def test_stale_excerpt_stays_hidden(public_transport, markup):
    examples = {
        "changed": b"<p>Updated details</p>",
        "script": page(AIIMS, excerpt=False),
        "hidden": f"<div hidden><h2>{AIIMS.source.section}</h2><div>{AIIMS.excerpt}</div></div>".encode(),
        "wrong-section": f"<h2>{AIIMS.source.section}</h2><h2>Other information</h2><p>{AIIMS.excerpt}</p>".encode(),
    }
    public_transport(lambda _: response(examples[markup]))
    result = asyncio.run(policies.lookup(AIIMS.source.id, 1))
    assert result.status == "stale" and result.source.url == AIIMS.source.url and result.excerpt is None


@pytest.mark.parametrize("failure", ["status", "type", "encoding", "size", "declared-size", "timeout", "redirect"])
def test_failed_fetch_is_distinct_from_stale(public_transport, failure):
    calls = 0

    def upstream(request):
        nonlocal calls
        calls += 1
        if failure == "timeout":
            raise httpx.ReadTimeout("internal host detail", request=request)
        options = {
            "status": lambda: httpx.Response(503),
            "type": lambda: response(b"%PDF-1.7", **{"content-type": "application/pdf"}),
            "encoding": lambda: response(page(VARANASI), **{"content-encoding": "gzip"}),
            "size": lambda: response(b"a" * (policies.MAX_BYTES + 1)),
            "declared-size": lambda: response(page(VARANASI), **{"content-length": str(policies.MAX_BYTES + 1)}),
            "redirect": lambda: httpx.Response(302, headers={"location": "https://example.invalid/private"}),
        }
        return options[failure]()

    public_transport(upstream)
    result = asyncio.run(policies.lookup(VARANASI.source.id, 1))
    assert calls == 1
    assert result.status == "failed" and result.excerpt is None
    assert "internal host detail" not in result.model_dump_json()


def test_only_reviewed_redirect_is_followed_and_cookies_are_discarded(public_transport):
    hosts = []

    def upstream(request):
        hosts.append(request.headers["host"])
        assert request.headers["host"] == request.extensions["sni_hostname"]
        assert "cookie" not in request.headers
        if len(hosts) == 1:
            return httpx.Response(302, headers={"location": AIIMS.redirect_urls[0], "set-cookie": "test=1; Domain=aiims.edu"})
        return response(page(AIIMS))

    public_transport(upstream)
    result = asyncio.run(policies.lookup(AIIMS.source.id, 1))
    assert hosts == ["aiims.edu", "www.aiims.edu"]
    assert result.status == "verified" and result.source.url == AIIMS.redirect_urls[0]


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "224.0.0.1", "::1"])
def test_private_ip_is_rejected_before_connecting(monkeypatch, address):
    async def simulate():
        async def resolve(*args, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]

        monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
        with pytest.raises(policies.SourceUnavailable):
            await policies._public_ip("aiims.edu")

    asyncio.run(simulate())


def test_whole_fetch_deadline_includes_dns(monkeypatch):
    async def slow_resolver(_):
        await asyncio.sleep(1)
        pytest.fail("Lookup exceeded its deadline")

    monkeypatch.setattr(policies, "DEADLINE", 0.01)
    monkeypatch.setattr(policies, "_public_ip", slow_resolver)
    assert asyncio.run(policies.lookup(AIIMS.source.id, 1)).status == "failed"
