"""Plain-language stages of a video run, worked out from what the agent does (its tool calls), never from
what it says. The worker appends a stage when it changes; the video page shows them with a progress bar.

The agent's order varies (it may record the voice before the storyboard, run the mixer early to time the
voice, go back to fix scenes), so each stage is listed once, the first time it happens, and "now" is
whatever it is doing at the moment. The bar follows time against the usual run, raised by the steps
that only come late.
"""

from __future__ import annotations

import json
import math
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

STAGES: Final[list[tuple[str, str, int]]] = [
    # key, label shown as "Now <label>", the least the bar shows once it has happened (only for late steps)
    ("request", "reading your request", 0),
    ("edit", "applying your edits", 0),
    ("restore", "bringing the version back", 0),
    ("prepare", "getting the video ready to edit", 0),
    ("site", "fetching the website", 0),
    ("study", "studying the product", 0),
    ("story", "writing the story", 0),
    ("plan", "planning the scenes", 0),
    ("build", "drafting the scenes", 0),
    ("render", "rendering the scenes", 55),
    ("check", "checking every frame", 65),
    ("sound", "mixing music and sound", 0),
    ("final", "rendering the final video", 90),
    ("done", "done", 100),
]
ORDER: Final = {k: i for i, (k, _, _) in enumerate(STAGES)}
LABEL: Final = {k: label for k, label, _ in STAGES}
PERCENT: Final = {k: p for k, _, p in STAGES}

EXPECTED_MIN: Final = (10, 15)
"""What a 30 s video usually takes, in minutes."""
EXPECTED_BY_LENGTH: Final = {"short": (10, 15), "medium": (20, 30), "long": (30, 45)}
"""What a video of each length usually takes, in minutes (short is measured; the longer two are estimates)."""
EXPECTED_CHANGE_MIN: Final = {"edit": (1, 3), "fix": (2, 6), "restore": (1, 1), "prepare": (1, 1)}
"""What a change usually takes, in minutes."""

_RULES: Final[list[tuple[str, re.Pattern[str]]]] = [
    # only actions count (writing a file, running a step, opening the capture), not reading kit files
    ("final", re.compile(r"^\[mcp__launchframe__kit\] build")),
    ("sound", re.compile(r"^\[Bash\] .*python3?[\d.]*\s+scripts/audio\.py|^\[(Write|Edit)\] .*timing\.json")),
    ("check", re.compile(r"^\[mcp__launchframe__kit\] still")),
    ("render", re.compile(r"^\[mcp__launchframe__kit\] scene")),
    ("build", re.compile(r"^\[(Write|Edit)\] .*src/(scenes|lib)/")),
    ("plan", re.compile(r"^\[(Write|Edit)\] .*video\.json")),
    ("story", re.compile(r"^\[(Write|Edit)\] .*STORYBOARD\.md")),
    ("study", re.compile(r"^\[(WebFetch|mcp__launchframe__capture)\]|^\[(Read|Bash)\] .*out/capture")),
]


def stage_of(line: str) -> str | None:
    """The stage an agent progress line belongs to, or ``None`` for lines that say nothing about it."""
    for key, rx in _RULES:
        if rx.search(line):
            return key
    return None


@dataclass
class Tracker:
    """Keeps ``stages.json`` (next to the agent's folder) up to date: each stage the first time it happens
    (oldest first, with the second it started) and what it is doing now."""

    path: Path
    t0: float = field(default_factory=time.monotonic)
    reached: list[dict[str, Any]] = field(default_factory=list)
    now: str = ""

    def enter(self, key: str) -> None:
        if key == self.now:
            return
        self.now = key
        if all(s["key"] != key for s in self.reached):
            self.reached.append({"key": key, "label": LABEL[key], "at": round(time.monotonic() - self.t0)})
        self._save()

    def see(self, line: str) -> None:
        key = stage_of(line)
        if key is not None:
            self.enter(key)

    def _save(self) -> None:
        tmp = self.path.with_suffix(".part")
        data = {"stages": self.reached, "now": self.now}
        tmp.write_text(json.dumps(data))
        tmp.replace(self.path)


def summary(
    state: dict[str, Any],
    elapsed_s: float,
    *,
    finished: bool,
    expected: tuple[int, int] = EXPECTED_MIN,
    first: str = "site",
) -> dict[str, Any]:
    """What the page shows: what it is doing now, a percent that only goes up, and the time so far.
    ``state`` is ``stages.json`` (``{}`` before the run starts)."""
    stages = [s for s in state.get("stages", []) if isinstance(s, dict) and s.get("key") in ORDER]
    now = str(state.get("now")) if state.get("now") in ORDER else first
    floor = max([PERCENT[s["key"]] for s in stages] + [0])
    usual = 60 * sum(expected) / 2  # a usual run, in seconds
    if elapsed_s <= usual:
        by_time = 88 * elapsed_s / usual
    else:  # past the usual time: keep moving, ever slower
        by_time = 88 + 10 * (1 - math.exp(-(elapsed_s - usual) / 300))
    pct = 100 if finished else min(99, round(max(floor, by_time)))
    return {
        "now": LABEL[now],
        "percent": pct,
        "elapsedS": round(elapsed_s),
        "expectedMin": list(expected),
        "stages": [{"label": s["label"], "at": s["at"], "current": s["key"] == now} for s in stages],
    }
