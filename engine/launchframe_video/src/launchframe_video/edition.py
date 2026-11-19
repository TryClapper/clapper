"""Which edition runs: ``paid`` (the hosted app, the default everywhere) or ``free`` (the open-source
edition, ``LF_EDITION=free``), which leaves out
the hosted app's paid features."""

from __future__ import annotations

import os
import random
from typing import Final, Literal

Edition = Literal["paid", "free"]

# 2026-11-19: the free edition gets three styles (Pile, Tangle and Dilemma, whose id is tangle-of-thoughts),
# picked at random for each video; nobody chooses one.
FREE_STYLES: Final = ("pile", "tangle", "tangle-of-thoughts")


def pick_free_style() -> str:
    """The style for a new free-edition video, at random."""
    return random.choice(FREE_STYLES)  # noqa: S311 (a style, not a secret)


def current() -> Edition:
    return "free" if os.environ.get("LF_EDITION") == "free" else "paid"
