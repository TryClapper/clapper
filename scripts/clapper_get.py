#!/usr/bin/env python3
"""Clapper Open Source's helper for Claude Code (Python's standard library only).

The plugin's code is open source (AGPL); the instructions Claude follows to make a video are run by Clapper
and fetched from it when needed. Only the piece's name is sent: never the site, the folder or anything about
the person.

    python3 clapper_get.py <piece>                      print one piece (e.g. skill)
    python3 clapper_get.py guides <video folder> <pile|tangle>
                                                        put KIT.md, DESIGN.md and the style's STYLES.md (and
                                                        Tangle's example spec) into the video's folder
    python3 clapper_get.py status <video folder>        where a stopped video left off, and what's next

``CLAPPER_INSTRUCTIONS_URL`` points at another address (tests and development). With no internet, or when
Clapper doesn't answer, it prints "Clapper needs an internet connection to make a video." and exits 2.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BASE = "https://tryclapper.co"
PIECES = (
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
USER_AGENT = "clapper-open-source"
OFFLINE = "Clapper needs an internet connection to make a video."
APPROVED = "Storyboard approved"


class OfflineError(Exception):
    pass


def fetch(piece: str) -> str:
    """One piece's text from Clapper."""
    if piece not in PIECES:
        raise ValueError(f"not a piece: {piece!r} (one of: {', '.join(PIECES)})")
    base = (os.environ.get("CLAPPER_INSTRUCTIONS_URL") or BASE).rstrip("/")
    req = urllib.request.Request(  # noqa: S310 (Clapper's address, or the tests')
        f"{base}/api/oss/instructions/{piece}", headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            text: str = r.read().decode("utf-8")
            return text
    except (urllib.error.URLError, OSError, UnicodeDecodeError, ValueError):
        raise OfflineError from None


def guides(folder: Path, style: str) -> list[Path]:
    """Fetch every guide first, then write them, so a lost connection never leaves the folder half-done."""
    if style not in ("pile", "tangle", "tangle-of-thoughts"):
        raise ValueError("the style is pile, tangle or tangle-of-thoughts")
    files = {
        Path("KIT.md"): fetch("kit"),
        Path("DESIGN.md"): fetch("design"),
        Path("STYLES.md"): fetch(f"style/{style}"),
    }
    if style != "pile":  # Tangle and Dilemma come with their example spec
        files[Path("styles") / style / "example.json"] = fetch(f"style/{style}/example")
    for rel, text in files.items():
        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
        (folder / rel).write_text(text, encoding="utf-8")
    return list(files)


# ---------------------------------------------------------------- picking up a stopped video


def _same(a: Path, b: Path) -> bool:
    return a.is_file() and b.is_file() and a.read_bytes() == b.read_bytes()


def _versions(folder: Path) -> list[int]:
    root = folder / "versions"
    if not root.is_dir():
        return []
    return sorted(int(p.name) for p in root.iterdir() if p.name.isdigit() and (p / "video.mp4").is_file())


def status(folder: Path, kit: Path) -> dict[str, Any]:
    """The step of the skill's "How a run goes" to carry on from, worked out from what is in ``folder``
    (``kit``: the plugin's kit, to tell the kit's own example files from the video's)."""
    done = _versions(folder)
    nxt = (done[-1] + 1) if done else 1

    def at(step: int, says: str) -> dict[str, Any]:
        return {"step": step, "says": says, "nextVersion": nxt, "versions": done}

    if not (folder / "package.json").is_file():
        return at(1, "nothing made yet: start from step 1.")
    if done:
        return at(
            8,
            f"version {done[-1]} is finished. Hand it over (step 8); a change is made in this folder and"
            f" saved as version {nxt}. Never overwrite a finished version.",
        )
    if (folder / "out" / "final.mp4").is_file():
        return at(
            7, f"out/final.mp4 is rendered but not saved: run the checks, then save it as version {nxt}."
        )
    if not all((folder / n).is_file() for n in ("KIT.md", "DESIGN.md", "STYLES.md")):
        return at(3, "the kit is copied but Clapper's guides aren't in the folder yet: carry on at step 3.")
    captured = (folder / "out" / "capture").is_dir() and any((folder / "out" / "capture").iterdir())
    if not (folder / "STORYBOARD.md").is_file() or _same(folder / "STORYBOARD.md", kit / "STORYBOARD.md"):
        if captured:
            return at(4, "the site is captured; finish the research (read STATE.md for notes so far).")
        return at(3, "the kit is copied and the guides are in; carry on from step 3 (research comes next).")
    state = (folder / "STATE.md").read_text(encoding="utf-8") if (folder / "STATE.md").is_file() else ""
    if APPROVED not in state:
        return at(5, "the storyboard is written but not approved yet: show it to the person and wait for go.")
    if _same(folder / "video.json", kit / "video.json"):
        return at(6, "the storyboard is approved; nothing is built yet: build from step 6.")
    return at(
        6,
        "the storyboard is approved and the video is partly built (video.json has the video's scenes): carry"
        " on building from step 6; keep the scenes already made, render only what isn't done.",
    )


def _kit_default() -> Path:
    return Path(__file__).resolve().parents[1] / "kit"


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argv else 1
    try:
        if argv[0] == "guides" and len(argv) == 3:
            for rel in guides(Path(argv[1]), argv[2]):
                print(f"wrote {rel}")
            return 0
        if argv[0] == "status" and len(argv) in (2, 4):
            kit = Path(argv[3]) if len(argv) == 4 and argv[2] == "--kit" else _kit_default()
            got = status(Path(argv[1]), kit)
            print(f"Resume at step {got['step']}: {got['says']}")
            print(json.dumps(got))
            return 0
        if len(argv) == 1:
            sys.stdout.write(fetch(argv[0]))
            return 0
    except OfflineError:
        print(OFFLINE)
        return 2
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    print(__doc__, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
