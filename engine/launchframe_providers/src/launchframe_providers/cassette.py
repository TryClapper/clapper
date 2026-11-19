"""Record / replay of LLM responses, keyed by the sha256 of the normalised request.

``LF_LLM=replay`` (default): read only; a missing cassette is an error, never a network call.
``LF_LLM=record``: replay when present, otherwise call the live client and save the answer.
``LF_LLM=live``: always call the live client, never read or write cassettes.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel

from launchframe_providers.call_log import CallLog
from launchframe_providers.hashing import request_hash
from launchframe_providers.llm import ContentBlock, LlmClient, LlmRequest, LlmResponse, Usage

LlmMode = Literal["replay", "record", "live"]
_STEP = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class CassetteResponse(BaseModel):
    content: list[ContentBlock]
    stopReason: str | None
    model: str
    usage: Usage
    costUsd: float
    latencyMs: int


class Cassette(BaseModel):
    key: str
    step: str
    promptVersion: str
    model: str
    recordedAt: str
    lastMessage: Any
    """the last message of the request, for humans reading the file"""
    response: CassetteResponse


class CassetteMissError(LookupError):
    def __init__(self, step: str, key: str, path: Path) -> None:
        super().__init__(
            f'no cassette for step "{step}" ({key[:12]}…) at {path}; record it with LF_LLM=record'
        )
        self.step = step
        self.key = key
        self.path = path


def cassette_path(directory: Path, step: str, key: str) -> Path:
    if not _STEP.match(step):
        raise ValueError(f"step {step!r} is not a safe cassette folder name")
    return directory / step / f"{key[:24]}.json"


class CassetteClient:
    def __init__(
        self,
        directory: str | Path,
        mode: LlmMode,
        live: Callable[[], LlmClient] | None = None,
        *,
        replay_log: CallLog | None = None,
    ) -> None:
        self.dir = Path(directory)
        self.mode: LlmMode = mode
        # built lazily: replay never builds a live client, so it needs no API key
        self._live = live
        # replays go to the call log only when asked (LF_LLM_CALL_LOG_REPLAY); live/record calls are
        # logged by the LoggedClient around the live client, never from the cassette
        self.replay_log = replay_log

    def call(self, req: LlmRequest) -> LlmResponse:
        key = request_hash(req)
        path = cassette_path(self.dir, req.step, key)
        if self.mode != "live" and path.exists():
            c = Cassette.model_validate(json.loads(path.read_text("utf8")))
            r = c.response
            res = LlmResponse(
                content=r.content,
                stopReason=r.stopReason,
                model=r.model,
                usage=r.usage,
                costUsd=0,
                latencyMs=0,
                source="replay",
                inputHash=key,
            )
            if self.replay_log is not None:
                self.replay_log.record(req, source="replay", latency_ms=0, res=res)
            return res
        if self.mode == "replay":
            raise CassetteMissError(req.step, key, path)
        if self._live is None:
            raise RuntimeError(f"LF_LLM={self.mode} needs a live client")
        res = self._live().call(req)
        if self.mode == "record":
            c = Cassette(
                key=key,
                step=req.step,
                promptVersion=req.promptVersion,
                model=req.model,
                recordedAt=datetime.now(UTC).isoformat(),
                lastMessage=req.messages[-1].model_dump(mode="json") if req.messages else None,
                response=CassetteResponse(
                    content=res.content,
                    stopReason=res.stopReason,
                    model=res.model,
                    usage=res.usage,
                    costUsd=res.costUsd,
                    latencyMs=res.latencyMs,
                ),
            )
            path.parent.mkdir(parents=True, exist_ok=True)
            text = json.dumps(c.model_dump(mode="json"), indent=2, ensure_ascii=False)
            path.write_text(text + "\n", "utf8")
        return res
