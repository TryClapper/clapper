"""Stable request hashing: equal requests always produce the same cassette key."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from launchframe_providers.llm import LlmRequest


def stable_stringify(v: Any) -> str:
    """JSON with sorted object keys and no whitespace."""
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def request_body(req: LlmRequest) -> dict[str, Any]:
    """Everything that changes the model's answer. ``meta`` (ids for cost rows) is excluded."""
    body: dict[str, Any] = req.model_dump(mode="json", exclude={"meta"}, exclude_none=True)
    return body


def request_hash(req: LlmRequest) -> str:
    return hashlib.sha256(stable_stringify(request_body(req)).encode("utf8")).hexdigest()
