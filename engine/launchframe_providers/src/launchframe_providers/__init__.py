"""Provider layer.

* LLM: the Anthropic client, record/replay cassettes, a hard budget cap, the JSONL cost ledger and a
  scripted fake client. Every AI step calls models only through :func:`create_llm_client`.
"""


from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Literal

from launchframe_providers.anthropic_client import FALLBACK_BETA, AnthropicLlm
from launchframe_providers.budget import (
    BudgetedClient,
    BudgetExceededError,
    estimate_input_tokens,
    worst_case_usd,
)
from launchframe_providers.call_log import (
    CallLog,
    LoggedClient,
    call_log_from_env,
    default_call_log_dir,
    log_replays_from_env,
    redact,
)
from launchframe_providers.cassette import Cassette, CassetteClient, CassetteMissError, LlmMode, cassette_path
from launchframe_providers.cost import (
    PRICES,
    CostEntry,
    CostSink,
    JsonlCostSink,
    MemoryCostSink,
    Price,
    cost_of,
    price_of,
)
from launchframe_providers.fake import FakeLlmClient, FakeReply, text_reply, tool_call
from launchframe_providers.hashing import request_hash, stable_stringify
from launchframe_providers.llm import (
    MODELS,
    ContentBlock,
    Effort,
    LlmClient,
    LlmMessage,
    LlmMeta,
    LlmRequest,
    LlmResponse,
    LlmTool,
    Model,
    Usage,
    text_of,
    tool_uses,
)

DEFAULT_LEDGER = "out/llm-cost.jsonl"
"""Relative to the repository root (the folder with ``pnpm-workspace.yaml``), not the working directory,
so the CLI, the API and the tests all write one ledger whichever folder they start in."""


def default_ledger_path() -> str:
    from pathlib import Path

    here = Path(__file__).resolve()
    for p in here.parents:
        if (p / "pnpm-workspace.yaml").is_file():
            return str(p / DEFAULT_LEDGER)
    return DEFAULT_LEDGER


def parse_mode(v: str | None) -> LlmMode:
    if v is None or v == "":
        return "replay"
    match v:
        case "replay" | "record" | "live":
            return v
    raise ValueError(f'LF_LLM must be replay, record or live (got "{v}")')


def create_llm_client(
    cassette_dir: str | Path,
    *,
    mode: LlmMode | None = None,
    sink: CostSink | None = None,
    budget_usd: float | None = None,
    live: LlmClient | None = None,
    call_log: CallLog | Literal["env"] | None = "env",
) -> CassetteClient:
    """The client every pipeline step should use: cassettes in front, then the budget guard and cost
    ledger, then the call log, then the live API. Replay mode never builds the live client (no key, no
    network).

    ``LF_LLM`` picks the mode (default replay); ``LF_LLM_BUDGET_USD`` is the hard cap over everything
    in the ledger and is required for record/live; ``LF_LLM_LEDGER`` is the JSONL ledger path.
    ``LF_LLM_CALL_LOG`` is the full call log directory (default ``out/llm-calls``; ``off`` disables it);
    every live and record call is logged, replays only with ``LF_LLM_CALL_LOG_REPLAY=1``.
    """
    m = mode if mode is not None else parse_mode(os.environ.get("LF_LLM"))
    raw_cap = os.environ.get("LF_LLM_BUDGET_USD")
    cap = budget_usd if budget_usd is not None else (float(raw_cap) if raw_cap else None)
    built: list[LlmClient] = []
    calls = call_log_from_env() if call_log == "env" else call_log

    def make_live() -> LlmClient:
        if built:
            return built[0]
        if cap is None or not math.isfinite(cap):
            raise RuntimeError(f"LF_LLM={m} needs a budget cap (LF_LLM_BUDGET_USD)")
        s = (
            sink
            if sink is not None
            else JsonlCostSink(os.environ.get("LF_LLM_LEDGER") or default_ledger_path())
        )
        inner: LlmClient = live if live is not None else AnthropicLlm()
        if calls is not None:
            # inside the budget guard: budget refusals are not API calls; API errors are logged
            inner = LoggedClient(inner, calls, "live" if m == "live" else "record")
        built.append(BudgetedClient(inner, s, cap))
        return built[0]

    replay_log = calls if calls is not None and log_replays_from_env() else None
    return CassetteClient(cassette_dir, m, make_live, replay_log=replay_log)


__all__ = [
    "DEFAULT_LEDGER",
    "FALLBACK_BETA",
    "MODELS",
    "PRICES",
    "AnthropicLlm",
    "BudgetExceededError",
    "BudgetedClient",
    "CallLog",
    "Cassette",
    "CassetteClient",
    "CassetteMissError",
    "ContentBlock",
    "CostEntry",
    "CostSink",
    "Effort",
    "FakeLlmClient",
    "FakeReply",
    "JsonlCostSink",
    "LlmClient",
    "LlmMessage",
    "LlmMeta",
    "LlmMode",
    "LlmRequest",
    "LlmResponse",
    "LlmTool",
    "LoggedClient",
    "MemoryCostSink",
    "Model",
    "Price",
    "Usage",
    "call_log_from_env",
    "cassette_path",
    "cost_of",
    "create_llm_client",
    "default_call_log_dir",
    "estimate_input_tokens",
    "parse_mode",
    "price_of",
    "redact",
    "request_hash",
    "stable_stringify",
    "text_of",
    "text_reply",
    "tool_call",
    "tool_uses",
    "worst_case_usd",
]
