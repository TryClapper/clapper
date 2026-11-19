"""The story, written before the video is made, so the person can read and change it first.

One model call reads the site (its copy and first screen) and writes a storyboard in the skill's own format
(the skill's storyboard template): scenes with a name, a beat, a length, what is on screen and optional
motion and camera notes. The person edits it, or writes it themselves, and the run follows it as written
(:func:`storyboard_md` becomes ``work/STORYBOARD.md``).
"""


from __future__ import annotations

import base64
import json
import math
import os
import re
from pathlib import Path
from typing import Any, Final

from launchframe_providers import create_llm_client, parse_mode
from launchframe_providers.llm import MODELS, LlmClient, LlmMessage, LlmMeta, LlmRequest, LlmTool, tool_uses
from launchframe_video import styles
from launchframe_video.files import read_plain

BEATS: Final = tuple(p.id for p in styles.LEGACY_PARTS)
"""The beats of a story written before styles (the old five)."""
MIN_SCENES, MAX_SCENES = 3, 14
MIN_SECONDS, MAX_SECONDS = 1.5, 20.0
MAX_TOTAL: Final = 130.0
LENGTHS: Final = {"short": (30, 40), "medium": (60, 80), "long": (90, 120)}
"""The lengths a person can pick, in seconds. Longer videos take longer and cost more to make."""
WORDS_PER_SECOND: Final = 2.3
LIMITS: Final = {"name": 40, "onScreen": 700, "motion": 300, "camera": 200, "vo": 300}
MAX_SCENE_IMAGES: Final = 3
IMAGE_KINDS: Final = ("product", "other")
MAX_SCENE_VISUALS: Final = 3
"""images and other visuals together on one scene"""
PROMPT_VERSION: Final = "story.v14"
SITE_CHARS: Final = 12_000
MORE_PAGES: Final = 15
"""product pages the site reader follows from the menu and its catalog for a product video (text only)"""
MORE_CHARS: Final = 4_000
"""each followed page's words, cut short (a catalog page, which names every product: CATALOG_CHARS)"""
CATALOG_CHARS: Final = 14_000


class BadStoryError(ValueError):
    """A story the video can't follow; the message says why, in plain words."""




MIN_OPENING_SHARE: Final = 0.18
"""A written hook, problem, fix story gives its opening (hook and problem) at least this share of the
video (planned: about 26%)."""
MIN_END_SECONDS: Final = 3.0


def time_budget(style: str | None, length: str) -> str:
    """Each part's planned seconds for the length: ``Opening 8-10 s, Product 14-18 s, ...``."""
    lo, hi = LENGTHS.get(length, LENGTHS["short"])
    return ", ".join(
        f"{p.label} {round(p.share * lo):g}-{round(p.share * hi):g} s" + ("" if p.required else " (optional)")
        for p in styles.parts_for(style)
    )


def off_balance(story: dict[str, Any]) -> str | None:
    """Why a hook, problem, fix story leaves too little time for its opening or its ending, or ``None``.
    The product may take whatever is left. Only for the problem styles."""
    if story.get("style") not in styles.PROBLEM_STYLES:
        return None
    scenes = [sc for sc in story.get("scenes", []) if isinstance(sc, dict)]
    total = sum(float(sc.get("seconds", 0)) for sc in scenes) or 1.0

    def seconds(beat: str) -> float:
        return sum(float(sc.get("seconds", 0)) for sc in scenes if sc.get("beat") == beat)

    opening, end = seconds("opening"), seconds("end")
    if opening < MIN_OPENING_SHARE * total:
        want = round(0.26 * total)
        return f"the opening has only {opening:g} s: give the hook and the problem about {want:g} s"
    if end < MIN_END_SECONDS:
        return (
            f"the end card has only {end:g} s: give the logo and call to action at least "
            f"{MIN_END_SECONDS:g} s"
        )
    return None


def off_length(story: dict[str, Any], length: str) -> str | None:
    """Why the story's scenes don't add up to the length the person picked, or ``None``. The video follows
    the story's timings exactly, so a 72 s story would make a 72 s video."""
    lo, hi = LENGTHS.get(length, LENGTHS["short"])
    total = sum(float(sc.get("seconds", 0)) for sc in story.get("scenes", []) if isinstance(sc, dict))
    if lo <= total <= hi:
        return None
    fix = "shorten or remove scenes" if total > hi else "lengthen or add scenes"
    return f"the scenes add up to {total:g} s, but a {lo}–{hi} second video needs {lo} to {hi} s: {fix}"


# ---------------------------------------------------------------- shape


def blank_story(length: str = "short", style: str | None = None) -> dict[str, Any]:
    """The style's parts, empty, for a person who writes the story themselves, at the middle of ``length``
    (35, 70 or 105 s). A long part becomes several scenes, none over 16 s; an optional part is left out.
    ``style`` ``None`` gives the old five beats."""
    lo, hi = LENGTHS.get(length, LENGTHS["short"])
    total = (lo + hi) / 2
    parts = [p for p in styles.parts_for(style) if p.required]
    spare = sum(p.share for p in styles.parts_for(style)) - sum(p.share for p in parts)
    scenes: list[dict[str, Any]] = []
    for part in parts:
        sec = total * (part.share + spare * part.share / (1 - spare))
        n = max(2 if part.id == "feature" else 1, math.ceil(sec / 16))
        for k in range(n):
            scenes.append(
                {
                    "name": part.label if n == 1 else f"{part.label} {k + 1}",
                    "beat": part.id,
                    "seconds": max(MIN_SECONDS, round(sec / n * 2) / 2),
                    "onScreen": "",
                    "motion": "",
                    "camera": "",
                    "vo": "",
                    "images": [],
                }
            )
    out: dict[str, Any] = {"scenes": scenes}
    if style is not None:
        out["style"] = style
    return out


def story_style(raw: Any) -> str | None:
    """The style a story follows (``None``: written before styles, the old five beats)."""
    st = raw.get("style") if isinstance(raw, dict) else None
    return st if st in styles.CHOICES else None


def validate_story(raw: Any, *, complete: bool = True) -> dict[str, Any]:
    """A clean story, or :class:`BadStoryError`. Its ``style`` (if any) decides its parts: every scene's
    beat is one of them, in the style's order, and (``complete``) every required part is there. ``complete``
    also needs every scene to say what is on screen (a person's half-written story may be saved without it,
    but the video can't start). Images are checked for shape here; that they exist is the draft's job."""
    if not isinstance(raw, dict) or not isinstance(raw.get("scenes"), list):
        raise BadStoryError("a story is a list of scenes")
    if raw.get("style") is not None and raw.get("style") not in styles.CHOICES:
        raise BadStoryError("that style isn't one we make")
    style = story_style(raw)
    parts = styles.parts_for(style)
    order = {p.id: i for i, p in enumerate(parts)}
    scenes = raw["scenes"]
    if not MIN_SCENES <= len(scenes) <= MAX_SCENES:
        raise BadStoryError(f"a story has {MIN_SCENES} to {MAX_SCENES} scenes")
    out: list[dict[str, Any]] = []
    for i, s in enumerate(scenes, 1):
        if not isinstance(s, dict):
            raise BadStoryError(f"scene {i} isn't a scene")
        scene: dict[str, Any] = {}
        for k, limit in LIMITS.items():
            v = s.get(k, "")
            if not isinstance(v, str):
                raise BadStoryError(f"scene {i}: {k} must be text")
            v = " ".join(v.split())  # one line: a field can't start a scene or a heading of its own
            if len(v) > limit:
                raise BadStoryError(f"scene {i}: keep {_label(k)} under {limit} characters")
            scene[k] = v
        if not scene["name"]:
            scene["name"] = f"Scene {i}"
        if s.get("beat") not in order:
            raise BadStoryError(f"scene {i}: the part is one of {', '.join(order)}")
        scene["beat"] = s["beat"]
        scene["images"] = _images(i, s.get("images"))
        arts: list[Any] = []
        visuals = "images"
        if len(scene["images"]) + len(arts) > MAX_SCENE_VISUALS:
            raise BadStoryError(f"scene {i}: up to {MAX_SCENE_VISUALS} {visuals}")
        sec = s.get("seconds")
        if isinstance(sec, bool) or not isinstance(sec, int | float) or not MIN_SECONDS <= sec <= MAX_SECONDS:
            raise BadStoryError(f"scene {i} lasts {MIN_SECONDS:g} to {MAX_SECONDS:g} seconds")
        scene["seconds"] = round(float(sec) * 2) / 2  # half seconds
        if complete and not scene["onScreen"]:
            raise BadStoryError(f"scene {i}: say what is on screen")
        out.append(scene)
    if sum(s["seconds"] for s in out) > MAX_TOTAL:
        raise BadStoryError(f"keep the whole video under {MAX_TOTAL:g} seconds")
    if style is None:
        return {"scenes": out}
    label = {p.id: p.label for p in parts}
    for i in range(1, len(out)):
        a, b = out[i - 1]["beat"], out[i]["beat"]
        if order[b] < order[a]:
            raise BadStoryError(
                f"scene {i + 1}: {label[b]} comes before {label[a]} in this style "
                f"({styles.structure_line(style)})"
            )
    if complete:
        have = {sc["beat"] for sc in out}
        missing = [p.label for p in parts if p.required and p.id not in have]
        if missing:
            raise BadStoryError(f"this style needs {', '.join(missing)} ({styles.structure_line(style)})")
    return {"style": style, "scenes": out}


_IMAGE_ID = re.compile(r"[0-9a-f]{10}")




def _images(i: int, raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_SCENE_IMAGES:
        raise BadStoryError(f"scene {i}: up to {MAX_SCENE_IMAGES} images")
    out: list[dict[str, Any]] = []
    for im in raw:
        if not isinstance(im, dict) or not isinstance(im.get("id"), str) or not _IMAGE_ID.fullmatch(im["id"]):
            raise BadStoryError(f"scene {i}: an image isn't one of the uploaded ones")
        if im.get("kind") not in IMAGE_KINDS:
            raise BadStoryError(f"scene {i}: an image is a product screen or another image")
        note = im.get("note", "")
        if not isinstance(note, str):
            raise BadStoryError(f"scene {i}: an image's note must be text")
        image: dict[str, Any] = {"id": im["id"], "kind": im["kind"], "note": " ".join(note.split())[:300]}
        out.append(image)
    return out


_LABELS: dict[str, str] = {"onScreen": "what's on screen"}


def _label(k: str) -> str:
    return _LABELS.get(k, f"the {k}")


_PROBLEM_BEATS: Final = frozenset({"opening", "hook", "problem"})


def brand_word(url: str) -> str:
    """The product's name as its site's address gives it ("https://www.acme.com/x" -> "acme"), or "" when
    it is too short to look for safely (a 3-letter name matches ordinary words)."""
    host = re.sub(r"^[a-z]+://", "", url.strip().lower()).split("/")[0].split(":")[0]
    parts = [p for p in host.split(".") if p and p != "www"]
    word = parts[-2] if len(parts) >= 2 else (parts[0] if parts else "")
    return word if len(word) >= 4 and word.isalnum() else ""


def off_brand(story: dict[str, Any], url: str) -> str | None:
    """Why the problem scenes show the product, or ``None``: before the first scene that isn't the hook or the
    problem, what's on screen must not name the product (its name or its domain). The problem is the world
    without it; the product arrives at the turn."""
    word = brand_word(url)
    if not word:
        return None
    pat = re.compile(rf"\b{re.escape(word)}\b", re.I)
    shown = []
    for i, sc in enumerate(story["scenes"], 1):
        if sc.get("beat") not in _PROBLEM_BEATS:
            break
        if pat.search(sc["onScreen"]):
            shown.append(str(i))
    if not shown:
        return None
    return (
        f"scene {', '.join(shown)} is the problem but shows the product ({word}) on screen: the problem "
        "never shows the product's name, logo, domain, links or look; use a neutral stand-in "
        "(a payment link at securepayment.link, a plain generic page) and bring the product in at the turn"
    )


def storyboard_md(
    story: dict[str, Any], *, product: str, fps: int = 60, image_files: dict[str, str] | None = None
) -> str:
    """The story in the skill's storyboard format (what the run reads as ``STORYBOARD.md``).
    ``image_files`` maps a scene image's id to its path in the video folder."""
    total = sum(s["seconds"] for s in story["scenes"])
    style = story_style(story)
    lines = [
        f"# {product} video: storyboard",
        "",
        f"{total:g} s · 1920 × 1080 · {fps} fps · {round(total * fps)} frames",
        "",
        "Approved by the client before the run. Keep every scene, its order, its on-screen copy and its VO.",
        "",
    ]
    if style == styles.AUTO:
        lines += [
            "Style: yours to pick from the problem-scene styles (STYLES.md); the scenes follow its "
            "structure:",
            f"{styles.structure_line(style)} (SKILL.md › 1b).",
            "",
        ]
    elif style is not None:
        lines += [
            f"Style: {styles.name_of(style)} (STYLES.md). The scenes follow its structure:",
            f"{styles.structure_line(style)} (SKILL.md › 1b).",
            "",
        ]
    label = {p.id: p.label for p in styles.parts_for(style)}
    files = image_files or {}
    t = 0.0
    for i, s in enumerate(story["scenes"], 1):
        a, b = t, t + s["seconds"]
        frames = f"frames {round(a * fps)}–{round(b * fps)}"
        part = label.get(s["beat"], s["beat"]) if style is not None else s["beat"]
        lines.append(f"**Scene {i} · {s['name']} ({part})** — {a:g}–{b:g} s, {frames}")
        lines.append(f"- On screen: {s['onScreen'] or '(to fill from the site)'}")
        lines.append(f"- Motion: {s['motion'] or '(your call)'}")
        lines.append(f"- Camera: {s['camera'] or '(your call)'}")
        lines.append(f"- VO: {s['vo'] or '(none)'}")
        for im in s.get("images") or []:
            if im["id"] not in files:
                continue
            if im["kind"] == "product":
                what = "product screen: a reference to redesign in code for this scene, never shown as is"
            else:
                what = "other image: show it as it is in this scene, or redraw it as SVG"
            note = f" ({im['note']})" if im.get("note") else ""
            lines.append(f"- Image: {files[im['id']]}, {what}{note}")
        lines.append("")
        t = b
    return "\n".join(lines)


# ---------------------------------------------------------------- writing it


def skill_story_rules(skill_dir: Path | None, text: str | None = None) -> str:
    """Section 1 (Story) of the skill, the rules the run itself writes stories by: from ``text`` (the skill
    itself, as the free edition fetches it) or ``skill_dir``'s SKILL.md."""
    if text is None:
        text = (read_plain(skill_dir / "SKILL.md") if skill_dir else None) or ""
    m = re.search(r"^## 1\. Story\n(.*?)^## 2\.", text, flags=re.S | re.M)
    rules = m.group(1).strip() if m else ""
    return rules.replace(_LONGER_LENGTH, "")  # here the person's picked length always wins


_LONGER_LENGTH: Final = " If that beats the asked length, take the longer length and say so in one line."



TOOL_NAME: Final = "write_storyboard"


def tool_for(
    style: str,
    length: str = "short",
    *,
    voice: bool = True,
) -> LlmTool:
    """The storyboard tool for ``style``: the beats are its parts; with ``auto``, also the style chosen."""
    if style == styles.AUTO:
        picks = list(styles.PROBLEM_STYLES)
        beats = sorted({p.id for k in picks for p in styles.STYLES[k].parts})
    else:
        picks, beats = [], [p.id for p in styles.parts_for(style)]
    lo, hi = LENGTHS.get(length, LENGTHS["short"])
    props: dict[str, Any] = {
        "plan": {
            "type": "string",
            "description": "before the scenes, a short plan. First the research: what the product offers "
            "(every product or feature you found across the site's pages and menu, one line each with the "
            "problem it solves) and who it's for. Then the story for this length: which one it centres on "
            "and why, which others it shows or names and where, the one customer and moment it follows, "
            "and the hook, problem, solution and payoff with the seconds each gets, so the whole thing "
            "lands in the time given",
        }
    }
    required = ["plan", "scenes"]
    if picks:
        props["style"] = {"type": "string", "enum": picks, "description": "the style you chose"}
        required.insert(1, "style")
    props["scenes"] = {
        "type": "array",
        "minItems": MIN_SCENES,
        "maxItems": MAX_SCENES,
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["name", "beat", "seconds", "onScreen", "motion", "camera"],
            "properties": {
                "name": {"type": "string", "description": "2-4 words"},
                "beat": {"type": "string", "enum": beats, "description": "the id of the style's part"},
                "seconds": {
                    "type": "number",
                    "description": f"length of the scene, in half seconds; all scenes together add up to "
                    f"{lo} to {hi} s",
                },
                "onScreen": {"type": "string"},
                "motion": {"type": "string", "description": "optional; empty when it doesn't matter"},
                "camera": {"type": "string", "description": "optional; empty when it doesn't matter"},
            },
        },
    }
    return LlmTool(
        name=TOOL_NAME,
        description="Send the storyboard: first your plan, then the scenes in order"
        + (", and the style you chose." if picks else "."),
        strict=False,
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "required": required,
            "properties": props,
        },
    )


TOOL: Final = tool_for(styles.AUTO)


def site_text(capture_dir: Path, n: int = 1) -> str:
    """The page's own words from a capture (title, description, headings, buttons, sections), cut short."""
    raw = read_plain(capture_dir / f"{n}.json")
    if raw is None:
        return ""
    try:
        info = json.loads(raw)
    except ValueError:
        return ""
    keep = {k: info.get(k) for k in ("url", "title", "description", "headings", "buttons") if info.get(k)}
    blocks = [b.get("text", "") for b in info.get("blocks") or [] if isinstance(b, dict)]
    keep["sections"] = [t for t in blocks if isinstance(t, str) and t.strip()]
    return json.dumps(keep, ensure_ascii=False)[:SITE_CHARS]


def menu(capture_dir: Path) -> list[str]:
    """The names in the site's own menu (from the first page's capture)."""
    raw = read_plain(capture_dir / "1.json")
    try:
        links = json.loads(raw).get("links") if raw else None
    except ValueError:
        return []
    names = [str(x.get("text", ""))[:80] for x in links or [] if isinstance(x, dict)]
    return list(dict.fromkeys(n for n in names if n.strip()))[:80]


def more_pages(capture_dir: Path) -> list[dict[str, Any]]:
    """The product pages the reader followed from the menu (``more-<k>.json``), in order."""
    out = []
    for k in range(1, MORE_PAGES + 4):
        raw = read_plain(capture_dir / f"more-{k}.json")
        if raw is None:
            break
        try:
            info = json.loads(raw)
        except ValueError:
            continue
        if isinstance(info, dict) and isinstance(info.get("url"), str):
            out.append(info)
    return out


def more_text(capture_dir: Path) -> str:
    """The followed pages' words for the writer, each cut short."""
    parts = []
    for info in more_pages(capture_dir):
        keep = {
            k: info.get(k) for k in ("url", "title", "description", "headings", "sections") if info.get(k)
        }
        catalog = re.search(
            r"\b(products?|features?|solutions?|platform)\b", f"{info.get('menu', '')} {info['url']}", re.I
        )
        cap = CATALOG_CHARS if catalog else MORE_CHARS
        parts.append(f"<page>\n{json.dumps(keep, ensure_ascii=False)[:cap]}\n</page>")
    return "\n".join(parts)




def _image(path: Path) -> dict[str, Any] | None:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 4 * 1024 * 1024:
        return None
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}}


def about_notes(about: dict[str, Any]) -> str:
    """A whole-product video's two answers as note lines (empty when neither was given)."""
    lines = []
    if str(about.get("problem") or "").strip():
        lines.append(f"The problem it solves: {str(about['problem']).strip()}")
    if str(about.get("solution") or "").strip():
        lines.append(f"How it solves it: {str(about['solution']).strip()}")
    return "\n".join(lines)


SECTION: Final = re.compile(r"^<!-- clapper:([a-z0-9:/_-]+) -->[ \t]*\n", re.M)


def served_parts(text: str) -> dict[str, str]:
    """The served writer's text by section (``<!-- clapper:name -->`` lines): ``system`` (the instructions),
    ``product`` (the brief, with ``{span}`` and ``{breadth}``), ``notes`` (what to make of the person's
    notes), ``breadth:short`` and the other lengths. Text before the first marker, or a text with none, is
    ``system``."""
    marks = list(SECTION.finditer(text))
    out = {"system": text[: marks[0].start()] if marks else text}
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        out[m.group(1)] = text[m.end() : end].strip("\n") + ("\n" if m.group(1) == "system" else "")
    return out


def fill(template: str, slots: dict[str, str]) -> str:
    """``template`` with each ``{slot}`` replaced; any other brace is left as it is (the free edition's
    instructions come from Clapper, so a stray brace there must never break a run)."""
    return re.sub(r"\{(\w+)\}", lambda m: slots.get(m.group(1), m.group(0)), template)


def request(
    *,
    skill_dir: Path | None,
    capture_dir: Path,
    url: str,
    kind: str,
    feature: dict[str, Any],
    about_in: dict[str, Any] | None = None,
    length: str = "short",
    style: str = styles.AUTO,
    meta: LlmMeta | None = None,
    edition: str = "paid",
    model: str = "claude-opus-5-5",
    instructions: str | None = None,
    skill: str | None = None,
) -> LlmRequest:
    """The story writer's request. The free edition passes ``instructions`` (the writer's text, with
    ``{length}``, ``{scenes}``, ``{style}``, ``{budget}`` and ``{rules}`` slots) and ``skill`` (the free
    skill, for its story rules), both served by Clapper; the paid app uses its own."""
    free = edition == "free"
    template, focus = instructions, ""
    if template is None:
        raise BadStoryError("the story writer's instructions are missing")
    if free:
        if style not in styles.choices_for("free"):
            raise BadStoryError(f"pick a style from: {', '.join(styles.choices_for('free'))}")
        kind = "product"  # the free edition makes product videos
    if model not in MODELS:
        raise BadStoryError(f"pick a model from: {', '.join(MODELS)}")
    lo, hi = LENGTHS.get(length, LENGTHS["short"])
    span = f"{lo}-{hi} seconds in all (the scene lengths must add up to that)"
    parts_of = served_parts(template)  # the free edition: every piece of the writer's text is served
    template = parts_of["system"]
    about = fill(
        parts_of.get("product", ""), {"span": span, "breadth": parts_of.get(f"breadth:{length}", "")}
    )
    notes_rule = parts_of.get("notes", "").strip()
    notes_rule = f" {notes_rule}" if notes_rule else ""
    notes = about_notes(about_in or {}) if kind != "feature" else ""
    if notes:
        about += notes_rule
    scenes = {"short": "4 to 6", "medium": "6 to 9", "long": "8 to 12"}.get(length, "4 to 6")
    content: list[dict[str, Any]] = []
    hero = _image(capture_dir / "1-hero.jpg")
    if hero:
        content += [{"type": "text", "text": "The site's first screen:"}, hero]
    parts = [
        f"<site url={json.dumps(url)}>\n{site_text(capture_dir) or '(the site could not be read)'}\n</site>"
    ]
    names = menu(capture_dir)
    if names:
        parts.append(f"<menu>\n{json.dumps(names, ensure_ascii=False)}\n</menu>")
    more = more_text(capture_dir)
    if more:
        parts.append(f"<more_pages>\n{more}\n</more_pages>")
    if kind != "feature" and notes:
        parts.append(f"<person_notes>\n{notes}\n</person_notes>")
    tool_extra: dict[str, Any] = {}
    parts.append("Write the storyboard.")
    content.append({"type": "text", "text": "\n\n".join(parts)})
    slots = {
        "length": about,
        "scenes": scenes,
        "style": styles.writer_brief(style, length, kind),
        "budget": time_budget(style, length),
        "focus": focus,
        "rules": skill_story_rules(skill_dir, skill),
    }
    # the paid text goes through str.format exactly as before; the served text through fill
    system = fill(template, slots) if free else template.format(**slots)
    return LlmRequest(
        step="story",
        promptVersion=PROMPT_VERSION,
        model=model,
        effort="medium",
        system=[system],
        tools=[tool_for(style, length, voice=not free, **tool_extra)],
        messages=[LlmMessage(role="user", content=content)],
        maxTokens=8000,
        meta=meta,
    )


def client() -> LlmClient:
    """The capped client every model call goes through (cassettes in tests, live in dev and production)."""
    from launchframe_video.agent import repo_root

    mode = parse_mode(os.environ.get("LF_LLM"))
    return create_llm_client(
        repo_root() / "out" / "cassettes" / "story", mode="live" if mode == "record" else mode
    )


def _styled(raw: Any, style: str, length: str) -> Any:
    """The writer's answer with its style: the one the person chose, or (``auto``) the one it chose."""
    if not isinstance(raw, dict):
        return raw
    if style != styles.AUTO:
        return {**raw, "style": style}
    picks = list(styles.PROBLEM_STYLES)
    if raw.get("style") not in picks:
        raise BadStoryError(f"pick the style from: {', '.join(picks)}")
    return raw


def write(
    req: LlmRequest,
    llm: LlmClient | None = None,
    *,
    style: str | None = None,
    length: str = "short",
    feature: str = "",
    url: str = "",
) -> tuple[dict[str, Any], float]:
    """Ask for the storyboard; up to ``TRIES`` tries, each wrong answer sent back with everything wrong
    with it (the length always included, so fixing one thing never hides another). Returns the story and
    its cost, or raises when it still isn't right: a story that doesn't fit the picked length is never
    handed back. ``style`` is what the request was made for (``None``: the old five beats).
    ``url``: the product's site; problem scenes that show the product go back (:func:`off_brand`)."""
    llm = llm or client()
    cost = 0.0
    messages = list(req.messages)
    err = "no storyboard came back"
    long_off = False
    for _ in range(TRIES):
        res = llm.call(req.model_copy(update={"messages": messages}))
        cost += res.costUsd
        uses = [u for u in tool_uses(res) if u.get("name") == TOOL_NAME]
        if not uses:
            break
        raw = uses[0].get("input")
        problems = []
        try:
            written = validate_story(raw if style is None else _styled(raw, style, length))
            offs = [off_balance(written)]
            offs.append(off_brand(written, url) if url else None)
            problems += [off for off in offs if off is not None]
        except BadStoryError as e:
            problems.append(str(e))
        if (off := _raw_off_length(raw, length)) is not None:
            problems.append(off)
        if not problems:
            return written, cost
        err = "; ".join(dict.fromkeys(problems))  # tell the writer everything wrong; it tries again
        long_off = _raw_off_length(raw, length) is not None
        messages = [
            *messages,
            LlmMessage(role="assistant", content=res.content),
            LlmMessage(
                role="user",
                content=[
                    {"type": "tool_result", "tool_use_id": uses[0]["id"], "is_error": True, "content": err}
                ],
            ),
        ]
    if long_off:
        lo, hi = LENGTHS.get(length, LENGTHS["short"])
        raise BadStoryError(f"it didn't fit in {lo}–{hi} seconds")
    raise BadStoryError(err)


TRIES: Final = 4


def _raw_off_length(raw: Any, length: str) -> str | None:
    """``off_length`` on the writer's answer as sent, before any other check, so the length is always
    reported, with each scene's seconds so the writer can see where the time went."""
    scenes = raw.get("scenes") if isinstance(raw, dict) else None
    if not isinstance(scenes, list):
        return None
    secs = []
    for sc in scenes:
        try:
            secs.append(float(sc.get("seconds", 0)) if isinstance(sc, dict) else 0.0)
        except (TypeError, ValueError):
            secs.append(0.0)
    off = off_length({"scenes": [{"seconds": x} for x in secs]}, length)
    if off is None:
        return None
    now = " + ".join(f"{x:g}" for x in secs)
    return f"{off} (now {now}); keep a calm pace and cut what the story can live without"
