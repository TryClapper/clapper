"""A local relay between the video agent and the Anthropic API.

The agent (Claude Code inside the Agent SDK) is started with ``ANTHROPIC_BASE_URL`` pointing here and a
one-run token instead of an API key. The relay:

- swaps the token for the real key, so the agent (and any shell command it runs) never sees the key;
- refuses a call that could pass the LLM spend cap, reserving its worst case in the shared ledger first
  (the same ledger and cap as every other AI call, ``LF_LLM_BUDGET_USD``);
- streams the answer straight back, and once it ends, settles the real cost and writes the call, input
  and output, to the AI log (``out/llm-calls``), tagged with the video's ids.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import math
import posixpath
import secrets
import socket
import threading
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from launchframe_providers.call_log import CallLog
from launchframe_providers.cost import FALLBACK_MODEL, CostEntry, CostSink, cost_of, dearest
from launchframe_providers.ledger import CapExceededError
from launchframe_providers.llm import Usage

log = logging.getLogger(__name__)

UPSTREAM = "https://api.anthropic.com"
MESSAGES = "/v1/messages"
COUNT_TOKENS = "/v1/messages/count_tokens"
ALLOWED = frozenset({MESSAGES, COUNT_TOKENS})
STEP = "video-agent"
PROMPT_VERSION = "launch-motion"
# headers never forwarded upstream (auth is replaced, the rest are hop-by-hop or recomputed)
_DROP = {"host", "x-api-key", "authorization", "content-length", "connection", "accept-encoding"}


def worst_case_usd(body: dict[str, Any], raw_len: int) -> float:
    """Every input token written to cache at the dearest model plus the full ``max_tokens`` of output."""
    p = dearest(str(body.get("model") or ""), FALLBACK_MODEL)
    tokens_in = math.ceil(raw_len / 3)
    tokens_out = int(body.get("max_tokens") or 32_000)
    return (tokens_in * p.cache_write + tokens_out * p.output) / 1_000_000


WEB_SEARCH_USD = 0.01
"""Anthropic's web search tool: $10 per 1,000 searches, on top of the tokens."""


@dataclass
class Assembled:
    """A streamed message rebuilt from its server-sent events."""

    model: str = ""
    content: list[dict[str, Any]] = field(default_factory=list)
    stop_reason: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    searches: int = 0
    """web searches Anthropic ran for this message (the server-side web search tool, billed per search)"""
    _json: dict[int, str] = field(default_factory=dict)

    def event(self, ev: dict[str, Any]) -> None:
        t = ev.get("type")
        if t == "message_start":
            m = ev.get("message") or {}
            self.model = m.get("model") or self.model
            self._usage(m.get("usage"))
        elif t == "content_block_start":
            self.content.append(dict(ev.get("content_block") or {}))
        elif t == "content_block_delta" and self.content:
            i = int(ev.get("index", len(self.content) - 1))
            b = self.content[min(i, len(self.content) - 1)]
            d = ev.get("delta") or {}
            dt = d.get("type")
            if dt == "text_delta":
                b["text"] = b.get("text", "") + d.get("text", "")
            elif dt == "thinking_delta":
                b["thinking"] = b.get("thinking", "") + d.get("thinking", "")
            elif dt == "signature_delta":
                b["signature"] = "(signature)"
            elif dt == "input_json_delta":
                self._json[i] = self._json.get(i, "") + d.get("partial_json", "")
        elif t == "content_block_stop":
            i = int(ev.get("index", -1))
            if i in self._json and 0 <= i < len(self.content):
                raw = self._json.pop(i)
                try:
                    self.content[i]["input"] = json.loads(raw) if raw else {}
                except ValueError:
                    self.content[i]["input"] = {"_raw": raw}
        elif t == "message_delta":
            self.stop_reason = (ev.get("delta") or {}).get("stop_reason") or self.stop_reason
            self._usage(ev.get("usage"))

    def _usage(self, u: Any) -> None:
        if isinstance(u, dict):
            stu = u.get("server_tool_use")
            n = stu.get("web_search_requests") if isinstance(stu, dict) else None
            if isinstance(n, int):
                self.searches = max(self.searches, n)
            for k in (
                "input_tokens",
                "output_tokens",
                "cache_creation_input_tokens",
                "cache_read_input_tokens",
            ):
                v = u.get(k)
                if isinstance(v, int):
                    self.usage[k] = max(self.usage.get(k, 0), v)


def sse_events(buf: bytearray) -> Iterator[dict[str, Any]]:
    """Pop complete ``data:`` events off ``buf`` (it keeps any partial tail)."""
    while True:
        cut = buf.find(b"\n\n")
        if cut < 0:
            return
        chunk = bytes(buf[:cut])
        del buf[: cut + 2]
        for line in chunk.split(b"\n"):
            if line.startswith(b"data:"):
                with contextlib.suppress(ValueError):
                    yield json.loads(line[5:].strip())


class Relay:
    """Run with :meth:`serve` (a background thread); point the agent at :attr:`base_url`."""

    def __init__(
        self,
        *,
        api_key: str,
        sink: CostSink,
        cap_usd: float,
        call_log: CallLog | None,
        tags: dict[str, str] | None = None,
        upstream: str = UPSTREAM,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key
        self.sink = sink
        self.cap_usd = cap_usd
        self.call_log = call_log
        self.tags = dict(tags or {})
        self.upstream = upstream.rstrip("/")
        self.transport = transport  # tests swap in a fake Anthropic
        self.token = "lfv-" + secrets.token_urlsafe(24)
        self.calls = 0
        self.cost_usd = 0.0
        self.refused: str | None = None
        self._lock = threading.Lock()
        self._server: uvicorn.Server | None = None
        self._thread: threading.Thread | None = None
        self.port = 0
        self.app = Starlette(routes=[Route("/{path:path}", self._handle, methods=["GET", "POST"])])

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    # -- lifecycle

    def serve(self) -> None:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        cfg = uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning", lifespan="off")
        self._server = uvicorn.Server(cfg)
        self._thread = threading.Thread(target=self._server.run, name="video-relay", daemon=True)
        self._thread.start()
        for _ in range(200):
            if self._server.started:
                return
            time.sleep(0.02)
        raise RuntimeError("video relay did not start")

    def close(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5)

    # -- requests

    def _authorized(self, req: Request) -> bool:
        got = req.headers.get("x-api-key") or req.headers.get("authorization", "").removeprefix("Bearer ")
        return secrets.compare_digest(got, self.token)

    def _headers(self, req: Request) -> dict[str, str]:
        h = {k: v for k, v in req.headers.items() if k.lower() not in _DROP}
        h["x-api-key"] = self.api_key
        return h

    async def _handle(self, req: Request) -> Response:
        if not self._authorized(req):
            return JSONResponse(
                {"type": "error", "error": {"type": "authentication_error", "message": "bad token"}}, 401
            )
        path = posixpath.normpath(req.url.path)
        if req.method != "POST" or path not in ALLOWED:
            # only the two endpoints Claude Code needs; everything else (files, batches, admin…) is refused
            return JSONResponse(
                {
                    "type": "error",
                    "error": {"type": "permission_error", "message": f"{req.method} {path} not allowed"},
                },
                403,
            )
        raw = await req.body()
        url = f"{self.upstream}{path}"
        if path == COUNT_TOKENS:
            # free (no tokens billed): passed through, not logged
            async with httpx.AsyncClient(timeout=120, transport=self.transport) as c:
                r = await c.post(url, content=raw, headers=self._headers(req))
            return Response(r.content, r.status_code, media_type=r.headers.get("content-type"))
        try:
            body: dict[str, Any] = json.loads(raw)
        except ValueError:
            return JSONResponse(
                {"type": "error", "error": {"type": "invalid_request_error", "message": "bad json"}}, 400
            )
        worst = worst_case_usd(body, len(raw))
        try:
            token = self.sink.reserve(worst, self.cap_usd)
        except CapExceededError as e:
            self.refused = (
                f"spend cap: spent ${e.spent_usd:.2f} + this call's worst case ${worst:.2f}"
                f" > cap ${self.cap_usd:.2f}"
            )
            return JSONResponse(
                {
                    "type": "error",
                    "error": {"type": "permission_error", "message": f"Clapper {self.refused}"},
                },
                403,
            )
        t0 = time.monotonic()
        client = httpx.AsyncClient(timeout=httpx.Timeout(600, connect=30), transport=self.transport)
        try:
            upstream = await client.send(
                client.build_request("POST", url, content=raw, headers=self._headers(req)), stream=True
            )
        except httpx.HTTPError as e:
            await client.aclose()
            self._settle(token, body, Assembled(), t0, f"{type(e).__name__}: {e}")
            return JSONResponse(
                {"type": "error", "error": {"type": "api_error", "message": "upstream unreachable"}}, 502
            )
        # Anthropic's own status and content type go back to the agent (its retry logic reads them)
        return StreamingResponse(
            self._forward(client, upstream, body, token, t0),
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/json"),
            headers={k: v for k, v in upstream.headers.items() if k.lower() in ("request-id", "retry-after")},
        )

    async def _forward(
        self, client: httpx.AsyncClient, r: httpx.Response, body: dict[str, Any], token: str, t0: float
    ) -> AsyncIterator[bytes]:
        msg = Assembled()
        error: str | None = None
        buf = bytearray()
        whole = bytearray()
        streamed = r.status_code == 200 and bool(body.get("stream"))
        try:
            # decoded bytes: the agent never sees a content-encoding header, so it must get plain bytes
            async for chunk in r.aiter_bytes():
                yield chunk
                if streamed:
                    buf.extend(chunk)
                    for ev in sse_events(buf):
                        msg.event(ev)
                else:
                    whole.extend(chunk)
            if r.status_code != 200:
                error = f"HTTP {r.status_code}: {bytes(whole[:2000]).decode('utf8', 'replace')}"
            elif not streamed:
                m = json.loads(bytes(whole))
                msg.model, msg.content, msg.stop_reason = (
                    m.get("model", ""),
                    m.get("content", []),
                    m.get("stop_reason"),
                )
                msg._usage(m.get("usage"))
        except (httpx.HTTPError, asyncio.CancelledError, ValueError) as e:
            error = f"{type(e).__name__}: {e}"
            if isinstance(e, asyncio.CancelledError):
                self._settle(token, body, msg, t0, error)
                await r.aclose()
                await client.aclose()
                raise
        finally:
            await r.aclose()
            await client.aclose()
        self._settle(token, body, msg, t0, error)

    def _settle(self, token: str, body: dict[str, Any], msg: Assembled, t0: float, error: str | None) -> None:
        usage = Usage(**msg.usage)
        model = msg.model or str(body.get("model") or "")
        billed = any(msg.usage.values()) or msg.searches > 0
        usd = (cost_of(usage, model) + msg.searches * WEB_SEARCH_USD) if billed else 0.0
        latency = int((time.monotonic() - t0) * 1000)
        now = datetime.now(UTC)
        input_hash = hashlib.sha256(
            json.dumps(body.get("messages", []), sort_keys=True).encode()
        ).hexdigest()[:16]
        try:
            self.sink.settle(
                token,
                CostEntry(
                    at=now.isoformat(),
                    step=STEP,
                    promptVersion=PROMPT_VERSION,
                    inputHash=input_hash,
                    model=model,
                    source="live",
                    latencyMs=latency,
                    usage=usage,
                    costUsd=usd,
                    **{k: v for k, v in self.tags.items() if k in ("videoId", "workspaceId", "projectId")},
                )
                if billed
                else None,
            )
        except Exception:
            log.warning("video relay: could not settle a reservation", exc_info=True)
        with self._lock:
            self.calls += 1
            self.cost_usd += usd
        if self.call_log is not None:
            self.call_log.record_raw(
                body,
                step=STEP,
                prompt_version=PROMPT_VERSION,
                tags=self.tags,
                latency_ms=latency,
                response=(
                    {
                        "model": model,
                        "content": msg.content,
                        "stopReason": msg.stop_reason,
                        "usage": usage.model_dump(),
                        "costUsd": usd,
                    }
                    if error is None
                    else None
                ),
                error=error,
            )
