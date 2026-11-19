"""The video styles a person can pick in setup, and the structure each one gives the story.

The problem-scene styles share one structure (an opening that shows the pain as that style's concrete thing,
the product, a callback that answers the opening, the end card). A story written before styles existed has no
style and keeps the old five beats.

The run's skill (``video/skill/launch-motion/SKILL.md`` › 1b, and the kit's ``STYLES.md``) describes the same
styles; keep the two in step.
"""


from __future__ import annotations

from dataclasses import dataclass
from typing import Final

AUTO: Final = "auto"
LEGACY: Final = "legacy"
"""A story from before styles: the five beats hook, problem, fix, payoff, logo."""


@dataclass(frozen=True)
class Part:
    id: str
    label: str
    share: float
    """its share of the video's length in a blank story"""
    required: bool = True
    hint: str = ""
    """what the part is, for the story writer and the person"""
    feature_hint: str = ""
    """what the part is in a video about one feature, when that differs (else ``hint``)"""


@dataclass(frozen=True)
class Style:
    id: str
    name: str
    blurb: str
    """one line for the picker"""
    fits: str
    """the products it fits, for the story writer"""
    parts: tuple[Part, ...]
    lengths: tuple[str, ...]


def _problem_parts(callback: bool, opening: str, callback_hint: str) -> tuple[Part, ...]:
    return (
        Part("opening", "Opening", 0.26, hint=opening),
        Part(
            "product",
            "Product",
            0.46,
            hint="the product fixes it on one concrete example, then at scale (one or more scenes)",
        ),
        Part("callback", "Callback", 0.14, required=callback, hint=callback_hint),
        Part("end", "End", 0.14, hint="the logo and the call to action"),
    )


ALL_LENGTHS: Final = ("short", "medium", "long")
MIN_SECONDS: Final = {"short": 30, "medium": 60, "long": 90}
"""the shortest video each length makes (story.LENGTHS has the ranges)"""

STYLES: Final[dict[str, Style]] = {
    s.id: s
    for s in (
        Style(
            "pile",
            "Pile",
            "Separate failures pile up on the customer, each with its cost.",
            "products that catch or prevent failures: QA, monitoring, security, compliance",
            _problem_parts(
                False,
                "attention, then the failures land one by one as cards, each with its cost, and a punch line",
                "optional: the same failure cards come back, caught by the product",
            ),
            ALL_LENGTHS,
        ),
        Style(
            "tangle",
            "Tangle",
            "Many connected parts; a failure starts in one and travels to a person.",
            "dev tools, infrastructure, testing platforms, integration-heavy products",
            _problem_parts(
                True,
                "the system's parts, wired together in a tangle; one part fails and the failure travels to a "
                "person, with its cost, and a punch line",
                "the same parts come back: the product drops in as the hub and the tangle becomes clean "
                "spokes",
            ),
            ALL_LENGTHS,
        ),
        Style(
            "tangle-of-thoughts",
            "Dilemma",
            "A hard decision with many considerations; a quick answer misses them.",
            "thinking, research and decision products, AI assistants, planning tools",
            _problem_parts(
                True,
                "a hard question surrounded by a tangle of considerations; a quick generic answer misses "
                "them and leads to a bad decision, and a punch line",
                "the same question and thoughts come back: the tangle lets go, the thoughts line up and run "
                "into one decision",
            ),
            ALL_LENGTHS,
        ),
    )
}

PROBLEM_PARTS: Final = STYLES["tangle"].parts
"""The parts of a story when the run picks the style (Hook, problem, fix with a story the person writes)."""

LEGACY_PARTS: Final = (
    Part("hook", "Hook", 0.12),
    Part("problem", "The problem", 0.22),
    Part("fix", "The fix", 0.34),
    Part("payoff", "Payoff", 0.17),
    Part("logo", "Logo", 0.15),
)

CHOICES: Final = (AUTO, *STYLES)
"""Every style a story can be in (the writer's pick is recorded as the problem style it chose)."""

WHOLE_VIDEO: tuple[str, ...] = ()
"""Formats that shape the whole video (not a problem scene the writer picks for "Hook, problem, fix")."""

PROBLEM_STYLES: Final = tuple(k for k in STYLES if k not in WHOLE_VIDEO)
"""What the writer picks from for "Hook, problem, fix"."""

OFFERED: tuple[str, ...] = (AUTO, *PROBLEM_STYLES)
"""What a person picks from, in the picker's order: every style, then Auto."""


def choices_for(edition: str) -> tuple[str, ...]:
    """The styles a story can be in for ``edition``: the free edition has Pile, Tangle and Dilemma (picked
    at random); the paid app has every style."""
    from launchframe_video.edition import FREE_STYLES

    return FREE_STYLES if edition == "free" else CHOICES


AUTO_NAME: Final = "Hook, problem, fix"
"""an ``auto`` story's name in messages (its problem style still to pick)"""
AUTO_PICK: Final = "Auto"
"""the picker's option for ``auto``"""
AUTO_BLURB: Final = (
    "Grabs attention with the pain your product removes, shows the fix, ends on your logo. "
    "We pick which problem style shows your product best."
)

TAGS: Final = {
    "pile": "Stacked failures",
    "tangle": "Connected failures",
    "tangle-of-thoughts": "Hard decisions",
    AUTO: "We choose",
}
"""Two words about each style, beside its name in the picker."""



def min_seconds(style: str | None) -> int:
    """The shortest video the style makes (30, or 60 for a style whose shortest length is medium)."""
    return MIN_SECONDS[lengths_for(style)[0]]


def parts_for(style: str | None) -> tuple[Part, ...]:
    """The parts a story in ``style`` is made of (``None`` or ``legacy``: the old five beats; ``auto``: the
    problem-scene parts, the run picking which problem style)."""
    if style in STYLES:
        return STYLES[style].parts
    if style == AUTO:
        return PROBLEM_PARTS
    return LEGACY_PARTS


def lengths_for(style: str | None) -> tuple[str, ...]:
    return STYLES[style].lengths if style in STYLES else ALL_LENGTHS


def name_of(style: str | None) -> str:
    if style in STYLES:
        return STYLES[style].name
    return AUTO_NAME if style == AUTO else ""


def structure_line(style: str | None) -> str:
    """The structure in one line: ``Opening → Product → Callback (optional) → End``."""
    return " → ".join(p.label + ("" if p.required else " (optional)") for p in parts_for(style))


def writer_brief(style: str, length: str, kind: str = "product") -> str:
    """What the story writer is told about the style: the chosen one's parts, or (``auto``) the five
    problem-scene styles to pick from. In a video about one feature (``kind``) each part is that feature's
    (its ``feature_hint`` where the part's own hint is about the whole product)."""
    if style in STYLES:
        s = STYLES[style]
        feature = kind == "feature"
        lines = [f'The person chose the style "{s.name}" ({s.blurb}). The scenes follow its parts, in order:']
        if feature:
            lines[0] += " This is a video about ONE feature, so every part is that feature's:"
        lines += [
            f"- {p.id} ({p.label}{'' if p.required else ', optional'}): "
            + (p.feature_hint if feature and p.feature_hint else p.hint)
            for p in s.parts
        ]
        return "\n".join(lines)
    lines = [
        "The person chose a hook, problem, fix video and left how the problem is shown to you. Research what "
        "the product does and the pain it removes, then pick the one style below that shows that pain best "
        "(the story decides the style, never the other way round), and send its id as style. Its parts give "
        "the scenes, in order."
    ]
    for s in (STYLES[k] for k in PROBLEM_STYLES):
        lines.append(f'\n"{s.id}": {s.name}. {s.blurb} Fits {s.fits}. Parts:')
        lines += [f"- {p.id} ({p.label}{'' if p.required else ', optional'}): {p.hint}" for p in s.parts]
    return "\n".join(lines)
