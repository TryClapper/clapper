"""The LLM port. Every model call in Clapper goes through an :class:`LlmClient` (SPEC §5: every AI
call is logged with input hash, output, model, latency and token cost per video).

The types are plain JSON-shaped models so tests, cassettes and M2 can use them without the SDK;
:mod:`launchframe_providers.anthropic_client` maps them to the Anthropic SDK.
"""

from __future__ import annotations

from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

Model = Literal["claude-opus-5-5", "claude-sonnet-5-5"]
MODELS: tuple[Model, ...] = ("claude-opus-5-5", "claude-sonnet-5-5")
Effort = Literal["low", "medium", "high", "xhigh", "max"]
Source = Literal["live", "replay", "fake"]

ContentBlock = dict[str, Any]
"""A response content block as plain JSON (text, tool_use, thinking, ...). Kept verbatim so it can be
passed back unchanged on a retry."""


class LlmTool(BaseModel):
    """A client tool. Sent with ``strict: true`` unless ``strict`` is ``False``, so ``input_schema`` must be
    strict-compatible (see :mod:`launchframe_ai.tool_schema`).

    The API caps strict tools at 24 optional parameters per request. Tool sets over that cap (the fill
    step's per-scene tools) go non-strict and rely on the full client-side validation + retry loop.
    ``None`` means strict and is left out of the cassette key, so existing recordings keep their keys."""

    model_config = ConfigDict(frozen=True)

    name: str
    description: str
    input_schema: dict[str, Any]
    strict: bool | None = None


class LlmMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str | list[dict[str, Any]]


class LlmMeta(BaseModel):
    """Ids put on every cost row. Not part of the cassette key."""

    videoId: str | None = None
    workspaceId: str | None = None
    projectId: str | None = None
    jobId: str | None = None
    """the job that made the call (call log only; the cost ledger keeps its own columns)"""


class LlmRequest(BaseModel):
    step: str
    """pipeline step, e.g. "storyboard", "fill", "chat" (cassette folder + cost rows)"""
    promptVersion: str
    """prompt version, e.g. "storyboard.v1"; part of the cassette key"""
    model: Model
    effort: Effort
    system: list[str]
    """system blocks in order; a cache breakpoint is placed after the last one"""
    tools: list[LlmTool]
    messages: list[LlmMessage]
    maxTokens: int = Field(gt=0)
    meta: LlmMeta | None = None


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


class LlmResponse(BaseModel):
    content: list[ContentBlock]
    stopReason: str | None
    model: str
    """model that produced the answer (may differ from the request when a server-side fallback ran)"""
    usage: Usage
    costUsd: float
    latencyMs: int
    source: Source
    inputHash: str
    """sha256 of the normalised request (the cassette key)"""


class LlmClient(Protocol):
    def call(self, req: LlmRequest) -> LlmResponse: ...


def tool_uses(res: LlmResponse) -> list[ContentBlock]:
    return [b for b in res.content if b.get("type") == "tool_use"]


def text_of(res: LlmResponse) -> str:
    return "\n".join(str(b.get("text", "")) for b in res.content if b.get("type") == "text")
