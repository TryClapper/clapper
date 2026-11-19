"""Hard spend cap + cost logging around a live client.

Before each call the worst case (every input token written to cache at the dearest possible model +
the full ``maxTokens`` of output) is added to what the ledger already holds; if that could pass the
cap, the call is refused before it is sent. So the cap is never exceeded. The check and a reservation
of the worst case happen atomically under the ledger lock (:mod:`launchframe_providers.ledger`), so
parallel calls in threads or processes cannot together pass the cap either.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

from launchframe_providers.cost import FALLBACK_MODEL, CostEntry, CostSink, dearest
from launchframe_providers.hashing import stable_stringify
from launchframe_providers.ledger import CapExceededError
from launchframe_providers.llm import LlmClient, LlmRequest, LlmResponse


class BudgetExceededError(RuntimeError):
    def __init__(self, spent_usd: float, worst_case_usd: float, cap_usd: float) -> None:
        super().__init__(
            f"LLM budget cap: spent ${spent_usd:.4f} + worst case ${worst_case_usd:.4f} for this call "
            f"> cap ${cap_usd:.2f}"
        )
        self.spent_usd = spent_usd
        self.worst_case_usd = worst_case_usd
        self.cap_usd = cap_usd


def estimate_input_tokens(req: LlmRequest) -> int:
    """Conservative estimate: ~3 characters per token over the whole request."""
    body = req.model_dump(mode="json", include={"system", "tools", "messages"})
    return math.ceil(len(stable_stringify(body)) / 3)


def worst_case_usd(req: LlmRequest) -> float:
    # a server-side fallback may answer on a dearer model; price the worst case at the fallback tier
    p = dearest(req.model, FALLBACK_MODEL)
    return (estimate_input_tokens(req) * p.cache_write + req.maxTokens * p.output) / 1_000_000


class BudgetedClient:
    def __init__(self, inner: LlmClient, sink: CostSink, cap_usd: float) -> None:
        if not math.isfinite(cap_usd) or cap_usd < 0:
            raise ValueError(f"budget cap must be a finite, non-negative number (got {cap_usd})")
        self.inner = inner
        self.sink = sink
        self.cap_usd = cap_usd

    def call(self, req: LlmRequest) -> LlmResponse:
        worst = worst_case_usd(req)
        try:
            # atomic check-and-reserve: parallel calls (threads, processes) can't together pass the cap
            token = self.sink.reserve(worst, self.cap_usd)
        except CapExceededError as e:
            raise BudgetExceededError(e.spent_usd, worst, self.cap_usd) from None
        try:
            res = self.inner.call(req)
        except BaseException:
            self.sink.settle(token, None)
            raise
        meta = req.meta.model_dump(exclude_none=True) if req.meta else {}
        self.sink.settle(
            token,
            CostEntry(
                at=datetime.now(UTC).isoformat(),
                step=req.step,
                promptVersion=req.promptVersion,
                inputHash=res.inputHash,
                model=res.model,
                source=res.source,
                latencyMs=res.latencyMs,
                usage=res.usage,
                costUsd=res.costUsd,
                **meta,
            ),
        )
        return res
