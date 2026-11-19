"""Scripted client for tests: never touches the network. Each call is answered by the next scripted
reply (or by a handler function), and every request is kept for assertions."""

from __future__ import annotations

import copy
import itertools
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from launchframe_providers.cost import cost_of
from launchframe_providers.hashing import request_hash
from launchframe_providers.llm import ContentBlock, LlmRequest, LlmResponse, Usage

_ids = itertools.count(1)


class FakeReply(BaseModel):
    content: list[ContentBlock]
    stopReason: str = "end_turn"
    usage: Usage | None = None


Handler = Callable[[LlmRequest, int], FakeReply]


def tool_call(name: str, input: Any, text: str | None = None) -> FakeReply:
    """A tool_use reply, the shape the model returns when it calls ``name``."""
    blocks: list[ContentBlock] = [{"type": "text", "text": text}] if text else []
    blocks.append({"type": "tool_use", "id": f"toolu_fake_{next(_ids)}", "name": name, "input": input})
    return FakeReply(content=blocks, stopReason="tool_use")


def text_reply(text: str) -> FakeReply:
    return FakeReply(content=[{"type": "text", "text": text}])


class FakeLlmClient:
    def __init__(self, replies: list[FakeReply] | Handler) -> None:
        self.requests: list[LlmRequest] = []
        self._queue = list(replies) if isinstance(replies, list) else []
        self._handler = None if isinstance(replies, list) else replies

    def call(self, req: LlmRequest) -> LlmResponse:
        n = len(self.requests)
        self.requests.append(req.model_copy(deep=True))
        if self._handler is not None:
            r = self._handler(req, n)
        elif self._queue:
            r = self._queue.pop(0)
        else:
            raise RuntimeError(f"FakeLlmClient: no scripted reply for call {n + 1} (step {req.step})")
        usage = r.usage or Usage(input_tokens=1000, output_tokens=500)
        return LlmResponse(
            content=copy.deepcopy(r.content),
            stopReason=r.stopReason,
            model=req.model,
            usage=usage,
            costUsd=cost_of(usage, req.model),
            latencyMs=1,
            source="fake",
            inputHash=request_hash(req),
        )
