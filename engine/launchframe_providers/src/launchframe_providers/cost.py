"""Price table and the cost ledger.

Prices are USD per million tokens (Anthropic first-party rates, claude-api skill table cached
2026-10-06). Cache writes use the 5-minute TTL rate (1.25 x input).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel

from launchframe_providers.ledger import JsonlLedger, MemoryLedger
from launchframe_providers.llm import Source, Usage


@dataclass(frozen=True)
class Price:
    input: float
    output: float
    cache_write: float
    cache_read: float


PRICES: dict[str, Price] = {
    "claude-opus-5-5": Price(4, 20, 5, 0.2),
    "claude-sonnet-5-5": Price(2, 10, 2.5, 0.2),
    # possible server-side fallback targets (priced so a fallback can never under-report spend)
    "claude-opus-5": Price(5, 25, 6.25, 0.5),
    "claude-opus-4-8": Price(5, 25, 6.25, 0.5),
}
FALLBACK_MODEL = "claude-opus-4-8"
"""The dearest model ``fallbacks: "default"`` may route to; the budget guard prices the worst case at it."""
UNKNOWN_PRICE = Price(10, 50, 12.5, 1)
"""Unknown models are priced at the most expensive tier, so the budget guard stays conservative."""


def price_of(model: str) -> Price:
    return PRICES.get(model, UNKNOWN_PRICE)


def dearest(*models: str) -> Price:
    return max((price_of(m) for m in models), key=lambda p: p.output, default=UNKNOWN_PRICE)


def cost_of(usage: Usage, *models: str) -> float:
    """USD for ``usage``; when a fallback ran the usage may mix models, so it is priced at the dearest."""
    p = dearest(*models)
    usd = (
        usage.input_tokens * p.input
        + usage.output_tokens * p.output
        + usage.cache_creation_input_tokens * p.cache_write
        + usage.cache_read_input_tokens * p.cache_read
    ) / 1_000_000
    return round(usd, 6)


class CostEntry(BaseModel):
    at: str
    step: str
    promptVersion: str
    inputHash: str
    model: str
    source: Source
    latencyMs: int
    usage: Usage
    costUsd: float
    videoId: str | None = None
    workspaceId: str | None = None
    projectId: str | None = None


class CostSink(Protocol):
    """Where cost rows go: JSONL locally, a DB table in M2 (per video and workspace, SPEC §11)."""

    def record(self, e: CostEntry) -> None: ...

    def total(self) -> float:
        """Total USD recorded so far."""
        ...

    def reserve(self, usd: float, cap_usd: float) -> str:
        """Atomically: refuse (:class:`launchframe_providers.ledger.CapExceededError`) if the total plus
        outstanding reservations plus ``usd`` passes ``cap_usd``, else hold ``usd`` back; a token."""
        ...

    def settle(self, token: str, entry: CostEntry | None) -> None:
        """Drop the reservation and record the call's actual cost row (``None``: the call failed)."""
        ...


class MemoryCostSink(MemoryLedger[CostEntry]):
    pass


class JsonlCostSink(JsonlLedger[CostEntry]):
    """Append-only JSONL ledger with atomic reservations (see :mod:`launchframe_providers.ledger`)."""

    def __init__(self, path: str | Path) -> None:
        super().__init__(path, CostEntry)
