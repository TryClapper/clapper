"""Live Claude client (Messages API via the ``anthropic`` Python SDK).

Request shape follows the claude-api skill for ``claude-opus-5-5`` / ``claude-sonnet-5-5``:

- adaptive thinking (it cannot be disabled on Opus 5.5) and an explicit ``output_config.effort``
  (Opus 5.5 defaults to medium, so it is always set)
- client tools with ``strict: true``; ``tool_choice: auto`` because forced tool choice is rejected on
  these models (the caller names the tool in the prompt and retries once if no call comes back)
- one cache breakpoint after the last system block, so tools + system are cached as one prefix
- streaming + ``get_final_message()``, because storyboard answers can be long
- server-side refusal fallback (``fallbacks: "default"``, beta ``server-side-fallback-2026-07-01``);
  the answer is priced at the dearest model involved
"""

from __future__ import annotations

import time
from typing import Any

import anthropic

from launchframe_providers.cost import cost_of
from launchframe_providers.hashing import request_hash
from launchframe_providers.llm import LlmRequest, LlmResponse, Usage

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicLlm:
    def __init__(
        self, *, api_key: str | None = None, fallbacks: bool = True, client: anthropic.Anthropic | None = None
    ) -> None:
        self._api_key = api_key
        self._client = client
        self.fallbacks = fallbacks

    @property
    def client(self) -> anthropic.Anthropic:
        # built on first use, so constructing AnthropicLlm needs no credentials
        if self._client is None:
            key = self._api_key
            self._client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
        return self._client

    def params(self, req: LlmRequest) -> dict[str, Any]:
        """The exact SDK keyword arguments for a request (exposed for tests: no network)."""
        last = len(req.system) - 1
        system: list[dict[str, Any]] = [
            {"type": "text", "text": t, **({"cache_control": {"type": "ephemeral"}} if i == last else {})}
            for i, t in enumerate(req.system)
        ]
        p: dict[str, Any] = {
            "model": req.model,
            "max_tokens": req.maxTokens,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": req.effort},
            "system": system,
            "tools": [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                    "strict": t.strict is not False,
                }
                for t in req.tools
            ],
            "tool_choice": {"type": "auto"},
            "messages": [m.model_dump(mode="json") for m in req.messages],
        }
        if self.fallbacks:
            p["betas"] = [FALLBACK_BETA]
            p["fallbacks"] = "default"
        return p

    def call(self, req: LlmRequest) -> LlmResponse:
        t0 = time.monotonic()
        with self.client.beta.messages.stream(**self.params(req)) as stream:
            msg = stream.get_final_message()
        u = msg.usage
        usage = Usage(
            input_tokens=u.input_tokens or 0,
            output_tokens=u.output_tokens or 0,
            cache_creation_input_tokens=u.cache_creation_input_tokens or 0,
            cache_read_input_tokens=u.cache_read_input_tokens or 0,
        )
        return LlmResponse(
            content=[b.model_dump(mode="json", exclude_none=True) for b in msg.content],
            stopReason=msg.stop_reason,
            model=msg.model,
            usage=usage,
            costUsd=cost_of(usage, req.model, msg.model),
            latencyMs=round((time.monotonic() - t0) * 1000),
            source="live",
            inputHash=request_hash(req),
        )
