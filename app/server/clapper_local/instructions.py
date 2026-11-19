"""The instructions Claude follows, fetched from Clapper when a video is made.

Clapper Open Source is open core: this code is AGPL, and the instructions (the skill, the story writer's and
"Ask for a fix" instructions, the Pile, Tangle and Dilemma style guides and the kit's guides) are run by
Clapper at ``GET {base}/api/oss/instructions/{piece}``. Only the piece's name is sent: never the site, the
key, the story or anything about the person (no cookies, no referrer, a fixed user agent).

``CLAPPER_INSTRUCTIONS_URL`` points at another address (tests and development); the default is Clapper's.
When Clapper can't be reached, :class:`OfflineError` carries the one message the page shows.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Final

BASE: Final = "https://tryclapper.co"
ENV: Final = "CLAPPER_INSTRUCTIONS_URL"
PIECES: Final = (
    "skill",
    "story",
    "fix",
    "kit",
    "design",
    "style/pile",
    "style/tangle",
    "style/tangle/example",
    "style/tangle-of-thoughts",
    "style/tangle-of-thoughts/example",
)
USER_AGENT: Final = "clapper-open-source"
TIMEOUT_S: Final = 30.0
OFFLINE: Final = "Clapper needs an internet connection to make a video."

SKILL_PATH: Final = Path(".claude") / "skills" / "launch-video" / "SKILL.md"


class OfflineError(Exception):
    """Clapper's instructions couldn't be fetched (no internet, or the service is down)."""

    def __init__(self) -> None:
        super().__init__(OFFLINE)


def base_url() -> str:
    return (os.environ.get(ENV) or BASE).rstrip("/")


def fetch(piece: str) -> str:
    """One piece's text. Raises ``ValueError`` for a name that isn't a piece, :class:`OfflineError` when
    Clapper can't be reached or doesn't answer with it."""
    if piece not in PIECES:
        raise ValueError(f"no such piece: {piece!r}")
    req = urllib.request.Request(  # noqa: S310 (http(s) only: the base is ours or the tests')
        f"{base_url()}/api/oss/instructions/{piece}", headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:  # noqa: S310
            text: str = r.read().decode("utf-8")
            return text
    except (urllib.error.URLError, OSError, UnicodeDecodeError, ValueError):
        raise OfflineError from None


def guides(style: str) -> dict[Path, str]:
    """What a video folder needs from Clapper before the build: the skill, KIT.md, DESIGN.md and the picked
    style's guide as STYLES.md (Tangle and Dilemma also get their example spec). Fetched all at once, so a
    run never starts half-instructed."""
    if style not in ("pile", "tangle", "tangle-of-thoughts"):
        raise ValueError(f"not a free style: {style!r}")
    out = {
        SKILL_PATH: fetch("skill"),
        Path("KIT.md"): fetch("kit"),
        Path("DESIGN.md"): fetch("design"),
        Path("STYLES.md"): fetch(f"style/{style}"),
    }
    if style != "pile":  # Tangle and Dilemma come with their example spec
        out[Path("styles") / style / "example.json"] = fetch(f"style/{style}/example")
    return out


def write(work: Path, files: dict[Path, str]) -> None:
    for rel, text in files.items():
        path = work / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
