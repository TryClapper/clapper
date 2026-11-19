"""The full LLM call log: every request sent to Claude and every answer (or error) that came back.

One JSONL file per UTC day (``<dir>/YYYY-MM-DD.jsonl``, default ``out/llm-calls/`` at the repository
root, ``LF_LLM_CALL_LOG`` overrides it, ``off`` disables it). Big repeated content is stored once,
content-addressed, under ``<dir>/blobs/`` and referenced by hash from the record:

* strings of :data:`BLOB_MIN_CHARS` or more (system prompts, Tessel docs, skills, source files):
  ``{"$blob": "<sha256>.txt", "chars": n}``
* message / response content blocks whose JSON is that big (tool results, earlier tool calls sent back
  on later turns): ``{"$blob": "<sha256>.json", "bytes": n, "type": "<block type>"}``
* the tool list when its JSON is that big: the same ``.json`` reference
* images (base64 sources): ``{"type": "image", "sha256": …, "bytes": n, "mediaType": …, "blob": …}``
  with the decoded bytes in ``blobs/<sha256>.<ext>``

Every stored string is scrubbed of API-key-shaped text first (:func:`redact`). Writing never fails a
call: IO errors are logged and dropped. Appends are one ``write`` of one line under a thread lock and
an ``flock``, so parallel calls (film runs) never interleave lines.

Retention is manual for now (delete old day files and orphaned blobs); production retention and
privacy rules are still to be decided.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import fcntl
import hashlib
import json
import logging
import os
import re
import secrets
import tempfile
import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from launchframe_providers.hashing import request_hash
from launchframe_providers.llm import LlmClient, LlmRequest, LlmResponse

log = logging.getLogger(__name__)

CallSource = Literal["live", "record", "replay", "fake"]
BLOB_MIN_CHARS = 2048
"""Strings and blocks at least this big go to ``blobs/`` (smaller ones stay inline)."""
THINKING = {"type": "adaptive"}
"""The thinking config :class:`launchframe_providers.anthropic_client.AnthropicLlm` always sends."""
DEFAULT_DIR = "out/llm-calls"

# ---------------------------------------------------------------- redaction

_SECRETS: list[tuple[str, re.Pattern[str]]] = [
    ("anthropic", re.compile(r"sk-ant-[A-Za-z0-9_\-]{8,}")),
    ("aws", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("aws", re.compile(r"(?i)(aws_secret_access_key[\"']?\s*[:=]\s*[\"']?)[A-Za-z0-9/+=]{30,}")),
    ("bearer", re.compile(r"(?i)(\bBearer\s+)[A-Za-z0-9\-._~+/]{12,}=*")),
]


def redact(s: str) -> str:
    """``s`` with anything shaped like an Anthropic, voice-service or AWS key or a Bearer token replaced by
    ``[REDACTED:<kind>]`` (a ``key: value`` prefix is kept)."""
    for kind, pat in _SECRETS:
        prefix = r"\g<1>" if pat.groups else ""  # keep a ``key: `` prefix captured by the pattern
        s = pat.sub(rf"{prefix}[REDACTED:{kind}]", s)
    return s


def _redact_all(v: Any) -> Any:
    if isinstance(v, str):
        return redact(v)
    if isinstance(v, list):
        return [_redact_all(x) for x in v]
    if isinstance(v, dict):
        return {k: _redact_all(x) for k, x in v.items()}
    return v


def _dumps(v: Any) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}


def default_call_log_dir() -> Path:
    here = Path(__file__).resolve()
    for p in here.parents:
        if (p / "pnpm-workspace.yaml").is_file():
            return p / DEFAULT_DIR
    return Path(DEFAULT_DIR)


def call_log_from_env() -> CallLog | None:
    """``LF_LLM_CALL_LOG``: unset → ``out/llm-calls/``; ``off`` → no log; otherwise the directory."""
    v = (os.environ.get("LF_LLM_CALL_LOG") or "").strip()
    if v.lower() in ("off", "0", "false", "no"):
        return None
    return CallLog(Path(v) if v else default_call_log_dir())


def log_replays_from_env() -> bool:
    return (os.environ.get("LF_LLM_CALL_LOG_REPLAY") or "").strip().lower() in ("1", "true", "yes", "on")


# ---------------------------------------------------------------- the store


class CallLog:
    """Writes call records and their blobs under ``directory``. Every public method swallows IO errors."""

    def __init__(self, directory: str | Path) -> None:
        self.dir = Path(directory)
        self.blobs = self.dir / "blobs"
        self._lock = threading.Lock()
        self._known: set[str] = set()

    # -- blobs

    def _put_blob(self, name: str, data: bytes) -> None:
        if name in self._known:
            return
        path = self.blobs / name
        if not path.exists():
            self.blobs.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.blobs, prefix=".tmp-")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                Path(tmp).replace(path)  # atomic; a concurrent writer of the same hash writes equal bytes
            except BaseException:
                with contextlib.suppress(OSError):
                    Path(tmp).unlink()
                raise
        self._known.add(name)

    def _text(self, s: str) -> Any:
        s = redact(s)
        if len(s) < BLOB_MIN_CHARS:
            return s
        data = s.encode("utf8")
        name = hashlib.sha256(data).hexdigest() + ".txt"
        self._put_blob(name, data)
        return {"$blob": name, "chars": len(s)}

    def _json(self, v: Any, kind: str | None) -> Any:
        """``v`` (already redacted, images already replaced) inline, or as a ``.json`` blob when big."""
        text = _dumps(v)
        if len(text) < BLOB_MIN_CHARS:
            return v
        data = text.encode("utf8")
        name = hashlib.sha256(data).hexdigest() + ".json"
        self._put_blob(name, data)
        ref: dict[str, Any] = {"$blob": name, "bytes": len(data)}
        if kind:
            ref["type"] = kind
        return ref

    def _images(self, v: Any) -> Any:
        """Base64 image sources replaced by a hash reference (bytes stored once); strings redacted."""
        if isinstance(v, str):
            return redact(v)
        if isinstance(v, list):
            return [self._images(x) for x in v]
        if not isinstance(v, dict):
            return v
        src = v.get("source")
        if v.get("type") == "image" and isinstance(src, dict) and src.get("type") == "base64":
            media = str(src.get("media_type") or "")
            try:
                raw = base64.b64decode(str(src.get("data") or ""), validate=False)
            except (binascii.Error, ValueError):
                raw = str(src.get("data") or "").encode("utf8")
            sha = hashlib.sha256(raw).hexdigest()
            name = f"{sha}.{_EXT.get(media, 'bin')}"
            self._put_blob(name, raw)
            return {"type": "image", "sha256": sha, "bytes": len(raw), "mediaType": media, "blob": name}
        return {k: self._images(x) for k, x in v.items()}

    def _block(self, b: Any) -> Any:
        if isinstance(b, str):
            return self._text(b)
        b = self._images(b)
        if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str):
            if len(b["text"]) >= BLOB_MIN_CHARS:
                return {**b, "text": self._text(b["text"])}
            return b
        if isinstance(b, dict) and b.get("type") == "image":
            return b
        return self._json(b, b.get("type") if isinstance(b, dict) else None)

    def _content(self, c: Any) -> Any:
        if isinstance(c, str):
            return self._text(c)
        if isinstance(c, list):
            return [self._block(b) for b in c]
        return _redact_all(c)

    # -- records

    def request_doc(self, req: LlmRequest) -> dict[str, Any]:
        tools = [
            {
                "name": t.name,
                "description": redact(t.description),
                "input_schema": _redact_all(t.input_schema),
                "strict": t.strict is not False,
            }
            for t in req.tools
        ]
        return {
            "system": [self._text(s) for s in req.system],
            "messages": [{"role": m.role, "content": self._content(m.content)} for m in req.messages],
            "tools": self._json(tools, "tools") if tools else [],
        }

    def record(
        self,
        req: LlmRequest,
        *,
        source: CallSource,
        latency_ms: int,
        res: LlmResponse | None = None,
        error: BaseException | None = None,
    ) -> str | None:
        """Write one call record; its id (``None`` when writing failed; the failure is only logged)."""
        try:
            now = datetime.now(UTC)
            rid = f"{now.strftime('%Y%m%dT%H%M%S')}-{secrets.token_hex(4)}"
            meta = req.meta.model_dump(exclude_none=True) if req.meta else {}
            rec: dict[str, Any] = {
                "id": rid,
                "at": now.isoformat(),
                "latencyMs": latency_ms,
                "source": source,
                "step": req.step,
                "promptVersion": req.promptVersion,
                **{k: redact(str(v)) for k, v in meta.items()},
                "model": req.model,
                "effort": req.effort,
                "maxTokens": req.maxTokens,
                "thinking": THINKING,
                "inputHash": res.inputHash if res is not None else request_hash(req),
                "request": self.request_doc(req),
            }
            if res is not None:
                rec["response"] = {
                    "model": res.model,
                    "content": [self._block(b) for b in res.content],
                    "stopReason": res.stopReason,
                    "usage": res.usage.model_dump(),
                    "costUsd": res.costUsd,
                }
            if error is not None:
                rec["error"] = error_doc(error)
            self._append(now, _dumps(rec))
            return rid
        except Exception:
            log.warning("LLM call log: could not write a record for step %s", req.step, exc_info=True)
            return None

    def record_raw(
        self,
        body: dict[str, Any],
        *,
        step: str,
        prompt_version: str,
        tags: dict[str, str],
        latency_ms: int,
        response: dict[str, Any] | None,
        error: str | None = None,
    ) -> str | None:
        """Write one call made outside :class:`LoggedClient` (the video agent's relay), from the raw Messages
        API request ``body`` and the assembled ``response`` (model, content, stopReason, usage, costUsd).
        Same record shape as :meth:`record`, so the AI log page and ``lf llm-log`` read it unchanged."""
        try:
            now = datetime.now(UTC)
            rid = f"{now.strftime('%Y%m%dT%H%M%S')}-{secrets.token_hex(4)}"
            system = body.get("system") or []
            if isinstance(system, str):
                system = [system]
            tools = body.get("tools") or []
            rec: dict[str, Any] = {
                "id": rid,
                "at": now.isoformat(),
                "latencyMs": latency_ms,
                "source": "live",
                "step": step,
                "promptVersion": prompt_version,
                **{k: redact(str(v)) for k, v in tags.items()},
                "model": str(body.get("model") or ""),
                "effort": (body.get("output_config") or {}).get("effort"),
                "maxTokens": body.get("max_tokens"),
                "thinking": body.get("thinking") or {},
                "inputHash": hashlib.sha256(_dumps(body.get("messages", [])).encode("utf8")).hexdigest(),
                "request": {
                    "system": [self._text(s) if isinstance(s, str) else self._block(s) for s in system],
                    "messages": [
                        {"role": m.get("role"), "content": self._content(m.get("content"))}
                        for m in body.get("messages", [])
                        if isinstance(m, dict)
                    ],
                    "tools": self._json(_redact_all(tools), "tools") if tools else [],
                },
            }
            if response is not None:
                content = [self._block(b) for b in response.get("content") or []]
                rec["response"] = {**response, "content": content}
            if error is not None:
                rec["error"] = {"type": "relay", "message": redact(error)[:4000]}
            self._append(now, _dumps(rec))
            return rid
        except Exception:
            log.warning("LLM call log: could not write a raw record for step %s", step, exc_info=True)
            return None

    def _append(self, now: datetime, line: str) -> None:
        data = (line + "\n").encode("utf8")
        path = self.dir / f"{now.strftime('%Y-%m-%d')}.jsonl"
        with self._lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX)  # other processes (workers) append to the same day file
                os.write(fd, data)
            finally:
                os.close(fd)

    # -- reading

    def files(self) -> list[Path]:
        return sorted(self.dir.glob("*.jsonl")) if self.dir.is_dir() else []

    def records(self) -> Iterator[dict[str, Any]]:
        for f in self.files():
            with f.open(encoding="utf8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue

    def expand(self, v: Any) -> Any:
        """``v`` with every ``$blob`` reference replaced by its content (images stay references)."""
        if isinstance(v, list):
            return [self.expand(x) for x in v]
        if not isinstance(v, dict):
            return v
        name = v.get("$blob")
        if isinstance(name, str) and re.fullmatch(r"[0-9a-f]{64}\.(txt|json)", name):
            try:
                text = (self.blobs / name).read_text("utf8")
            except OSError:
                return {**v, "missing": True}
            return text if name.endswith(".txt") else self.expand(json.loads(text))
        return {k: self.expand(x) for k, x in v.items()}


def error_doc(e: BaseException) -> dict[str, Any]:
    """Type, message, HTTP status and request id of an API error (Anthropic SDK errors carry the last two)."""
    d: dict[str, Any] = {"type": type(e).__name__, "message": redact(str(e))}
    status = getattr(e, "status_code", None)
    if isinstance(status, int):
        d["status"] = status
    rid = getattr(e, "request_id", None)
    if isinstance(rid, str) and rid:
        d["requestId"] = rid
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        d["body"] = _redact_all(body)
    return d


class LoggedClient:
    """Puts every call ``inner`` makes (answer or error) in ``log``; never changes what the call does."""

    def __init__(self, inner: LlmClient, log: CallLog, source: CallSource) -> None:
        self.inner = inner
        self.log = log
        self.source: CallSource = source

    def call(self, req: LlmRequest) -> LlmResponse:
        t0 = time.monotonic()
        try:
            res = self.inner.call(req)
        except Exception as e:
            self.log.record(req, source=self.source, latency_ms=_ms(t0), error=e)
            raise
        self.log.record(req, source=self.source, latency_ms=res.latencyMs or _ms(t0), res=res)
        return res


def _ms(t0: float) -> int:
    return round((time.monotonic() - t0) * 1000)


# ---------------------------------------------------------------- summaries (CLI and the API viewer)


def _answer_text(rec: dict[str, Any], log: CallLog | None) -> str:
    """The answer's text blocks (blobs expanded only when ``log`` is given), then its tool calls."""
    res = rec.get("response") or {}
    parts: list[str] = []
    tools: list[str] = []
    for b in res.get("content") or []:
        if not isinstance(b, dict):
            continue
        if "$blob" in b:
            if log is None:
                tools.append(f"[{b.get('type') or 'block'}: {b.get('bytes', '?')} bytes]")
                continue
            b = log.expand(b)
            if not isinstance(b, dict):
                continue
        if b.get("type") == "text":
            t = b.get("text")
            if isinstance(t, dict):
                t = log.expand(t) if log is not None else f"[{t.get('chars', '?')} chars]"
            parts.append(str(t))
        elif b.get("type") == "tool_use":
            tools.append(f"→ {b.get('name')}(" + _dumps(b.get("input"))[:200] + ")")
    return "\n".join(parts + tools)


def summary(rec: dict[str, Any], log: CallLog | None = None) -> dict[str, Any]:
    """The list row for one record: no blobs are read unless ``log`` is given."""
    res = rec.get("response") or {}
    u = res.get("usage") or {}
    err = rec.get("error")
    return {
        "id": rec.get("id"),
        "at": rec.get("at"),
        "source": rec.get("source"),
        "step": rec.get("step"),
        "promptVersion": rec.get("promptVersion"),
        "projectId": rec.get("projectId"),
        "jobId": rec.get("jobId"),
        "workspaceId": rec.get("workspaceId"),
        "model": res.get("model") or rec.get("model"),
        "inputTokens": int(u.get("input_tokens") or 0),
        "outputTokens": int(u.get("output_tokens") or 0),
        "cacheReadTokens": int(u.get("cache_read_input_tokens") or 0),
        "cacheWriteTokens": int(u.get("cache_creation_input_tokens") or 0),
        "costUsd": float(res.get("costUsd") or 0),
        "latencyMs": int(rec.get("latencyMs") or 0),
        "stopReason": res.get("stopReason"),
        "error": {"type": err.get("type"), "message": str(err.get("message"))[:500]}
        if isinstance(err, dict)
        else None,
        "answer": _answer_text(rec, log)[:400],
    }


def select(
    records: Iterator[dict[str, Any]],
    *,
    project: str | None = None,
    job: str | None = None,
    step: str | None = None,
) -> list[dict[str, Any]]:
    return [
        r
        for r in records
        if (project is None or r.get("projectId") == project)
        and (job is None or r.get("jobId") == job)
        and (step is None or r.get("step") == step)
    ]


def format_summary(s: dict[str, Any], lines: int = 3) -> str:
    who = " ".join(f"{k}={s[k]}" for k in ("projectId", "jobId") if s.get(k))
    head = (
        f"{s['id']}  {str(s['at'])[:19]}  {s['source']:<6} {s['step']} ({s['promptVersion']})  {s['model']}"
        + (f"  {who}" if who else "")
    )
    tok = (
        f"  in {s['inputTokens']:,}  out {s['outputTokens']:,}  cache r/w {s['cacheReadTokens']:,}/"
        f"{s['cacheWriteTokens']:,}  ${s['costUsd']:.4f}  {s['latencyMs']:,} ms  stop={s['stopReason']}"
    )
    out = [head, tok]
    if s.get("error"):
        out.append(f"  ERROR {s['error']['type']}: {s['error']['message'][:300]}")
    out += ["  | " + ln for ln in str(s.get("answer") or "").splitlines()[:lines]]
    return "\n".join(out)


def find(log: CallLog, rid: str) -> dict[str, Any] | None:
    """The record with id ``rid``; ids start with the UTC day, so only that day's file is read."""
    m = re.match(r"^(\d{4})(\d{2})(\d{2})T", rid)
    files = [log.dir / f"{m.group(1)}-{m.group(2)}-{m.group(3)}.jsonl"] if m else log.files()
    for f in files:
        if not f.is_file():
            continue
        with f.open(encoding="utf8") as fh:
            for line in fh:
                if rid not in line:
                    continue
                with contextlib.suppress(json.JSONDecodeError):
                    r = json.loads(line)
                    if isinstance(r, dict) and r.get("id") == rid:
                        return r
    return None
