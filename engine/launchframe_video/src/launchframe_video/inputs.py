"""What the person gives a video before it starts: the brand (fetched from the site, then edited), their logo,
screenshots of their product, and whether the video is about the whole product or one feature.

Everything lives in ``<video>/inputs/`` (beside the agent's ``work/``, never inside it): ``draft.json``, the
site capture (``out/capture/``), ``logo.*``, ``screenshots/`` and ``scenes/`` (images the person attached to a
story scene). When the video starts, :func:`hand_over`
copies what the agent needs into ``work/inputs/`` and :func:`brief_section` tells it how to use them.
"""

from __future__ import annotations

import colorsys
import copy
import json
import logging
import re
import shutil
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path
from typing import Any, Final, Literal
from urllib.parse import urlsplit
from xml.etree import ElementTree

from launchframe_video.files import read_plain
from launchframe_video.styles import AUTO, OFFERED, lengths_for, name_of, parts_for, structure_line

log = logging.getLogger(__name__)

INPUTS: Final = "inputs"
DRAFT: Final = "draft.json"
MAX_SCREENSHOTS: Final = 8
MAX_IMAGE_BYTES: Final = 8 * 1024 * 1024
MAX_LOGO_BYTES: Final = 2 * 1024 * 1024
MAX_SCENE_IMAGE_FILES: Final = 24
BRAND_KEYS: Final = ("background", "text", "accent", "font")

Kind = Literal["product", "feature"]
DraftState = Literal["fetching", "ready", "failed"]


class BadInputError(ValueError):
    """An upload or a field the video can't use; the message says why, in plain words."""


def inputs_dir(run_dir: Path) -> Path:
    return run_dir / INPUTS


StoryState = Literal["none", "writing", "ready", "failed"]


def new_draft(
    url: str,
    *,
    kind: Kind = "product",
    feature: dict[str, str] | None = None,
    about: dict[str, str] | None = None,
    story: Literal["write", "manual", "none"] = "none",
    length: Literal["short", "medium", "long"] = "short",
    style: str = AUTO,
) -> dict[str, Any]:
    """A new setup. ``story``: ``write`` has the story written once the site is read, ``manual`` starts
    the person on the style's empty parts, ``none`` leaves the story to the run (the old way). ``style``
    is one of :data:`styles.OFFERED` (``auto``: hook, problem, fix; we pick how the problem is shown)."""
    from launchframe_video.story import blank_story

    if style not in OFFERED:
        raise BadInputError(PICK_A_STYLE)
    if length not in lengths_for(style):
        raise BadInputError(f"{name_of(style)} needs {_lengths_words(style)}")
    return {
        "url": url,
        "length": length,
        "style": style,
        "story": blank_story(length, style) if story == "manual" else None,
        "storyState": {"write": "writing", "manual": "ready", "none": "none"}[story],
        "storyError": None,
        "state": "fetching",
        "error": None,
        "fetched": {},
        "brand": {},
        "logo": None,
        "kind": kind,
        "feature": {"name": "", "details": "", "url": "", **(feature or {})},
        "about": clean_about(about or {}),
        "screenshots": [],
        "sceneImages": [],
    }


PICK_A_STYLE: Final = "pick one of the styles, or Auto"


ABOUT_MAX: Final = 600


def clean_about(raw: dict[str, Any]) -> dict[str, str]:
    """A whole-product video's two optional answers: the problem the product solves and how it solves it
    (the person's words, kept as data)."""
    problem, solution = str(raw.get("problem") or "").strip(), str(raw.get("solution") or "").strip()
    if len(problem) > ABOUT_MAX or len(solution) > ABOUT_MAX:
        raise BadInputError(f"keep the problem and how you solve it under {ABOUT_MAX} characters each")
    return {"problem": problem, "solution": solution}


def _lengths_words(style: str) -> str:
    from launchframe_video.story import LENGTHS

    lo = min(LENGTHS[k][0] for k in lengths_for(style))
    return f"{lo} seconds or longer"


def load_draft(run_dir: Path) -> dict[str, Any] | None:
    raw = read_plain(inputs_dir(run_dir) / DRAFT)
    try:
        out = json.loads(raw) if raw else None
    except ValueError:
        return None
    return out if isinstance(out, dict) else None


def save_draft(run_dir: Path, draft: dict[str, Any]) -> None:
    d = inputs_dir(run_dir)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".{DRAFT}.{uuid.uuid4().hex[:6]}"
    tmp.write_text(json.dumps(draft, indent=2))
    tmp.replace(d / DRAFT)


# ---------------------------------------------------------------- brand from the capture

_RGB = re.compile(r"rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)")


def to_hex(css: str) -> str | None:
    """``rgb(17, 24, 39)`` → ``#111827``; ``None`` for anything see-through or not rgb()."""
    m = _RGB.fullmatch(css.strip())
    if not m:
        return None
    alpha = m.group(4)
    if alpha is not None and (float(alpha.rstrip("%")) / (100 if alpha.endswith("%") else 1)) < 0.9:
        return None
    return "#" + "".join(f"{min(255, int(m.group(i))):02x}" for i in (1, 2, 3))


def _hsv(hex_: str) -> tuple[float, float, float]:
    r, g, b = (int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return colorsys.rgb_to_hsv(r, g, b)


def brand_from_capture(info: dict[str, Any]) -> dict[str, str]:
    """The site's background, text and accent colours and its main font, from capture.mjs's JSON."""
    bgs = [h for v in info.get("backgrounds", []) if (h := to_hex(str(v.get("value", ""))))]
    inks = [h for v in info.get("textColors", []) if (h := to_hex(str(v.get("value", ""))))]
    body = to_hex(str(info.get("bodyBackground", "")))
    background = body or (bgs[0] if bgs else "#ffffff")
    text = next((c for c in inks if c != background), "#111111")
    # the accent: the most used colour with some colour in it (not grey, not near black or white)
    accent = next((c for c in bgs + inks if _hsv(c)[1] > 0.3 and _hsv(c)[2] > 0.25), text)
    # the headline font as the site sets it (capture's measured type), else the most used font
    typ = info.get("type")
    display = typ.get("display") if isinstance(typ, dict) else None
    if not isinstance(display, dict):
        display = {}
    fonts = [str(display.get("family", ""))] + [str(f.get("value", "")) for f in info.get("fonts", [])]
    font = next(
        (f for f in fonts if f and not f.startswith(("-", "ui-", "system")) and f != "sans-serif"), ""
    )
    return {"background": background, "text": text, "accent": accent, "font": font}


def finish_fetch(run_dir: Path, summary: str, fonts: list[str] | None = None) -> dict[str, Any]:
    """Read the capture written under ``inputs/out/capture`` into the draft: brand and logo."""
    draft = load_draft(run_dir) or {}
    cap = inputs_dir(run_dir) / "out" / "capture"
    raw = read_plain(cap / "1.json")
    if raw is None:
        draft.update(state="failed", error=_why(summary))
        save_draft(run_dir, draft)
        return draft
    info = json.loads(raw)
    fetched = brand_from_capture(info)
    draft.update(state="ready", error=None, fetched=fetched)
    draft["brand"] = {**fetched, **{k: v for k, v in (draft.get("brand") or {}).items() if v}}
    logo = cap / "1-logo.png"
    if draft.get("logo") is None and logo.is_file() and not logo.is_symlink():
        shutil.copyfile(logo, inputs_dir(run_dir) / "logo.png")
        draft["logo"] = {"file": "logo.png", "source": "site"}
    settle_font(draft, fonts or [])
    save_draft(run_dir, draft)
    return draft


def closest_font(name: str, choices: list[str]) -> str:
    """The installed family for a site's font: the same one when it is installed, otherwise the nearest kind
    (mono, serif, else the clean house headline font)."""
    key = re.sub(r"[^a-z0-9]", "", name.lower())
    for c in choices:
        if re.sub(r"[^a-z0-9]", "", c.lower()) == key:
            return c
    pick = (
        "JetBrains Mono"
        if "mono" in key
        else "Instrument Serif"
        if "serif" in key and "sans" not in key
        else "Inter Tight"
    )
    return pick if pick in choices or not choices else choices[0]


def settle_font(draft: dict[str, Any], choices: list[str]) -> dict[str, Any]:
    """Make the brand font one the video can use; the site's own name is kept as ``siteFont`` to show."""
    brand = draft.setdefault("brand", {})
    font = str(brand.get("font") or "")
    if choices and font and font not in choices:
        draft["siteFont"] = font
        brand["font"] = closest_font(font, choices)
        if (draft.get("fetched") or {}).get("font") == font:
            draft["fetched"]["font"] = brand["font"]
    return draft


def _why(summary: str) -> str:
    if "capture failed" in summary or summary.startswith("error"):
        return "We couldn't open that site. Check the address, or set the brand by hand."
    return "We couldn't read that site's brand. Set it by hand."


# ---------------------------------------------------------------- what the person changes

_HEX = re.compile(r"#[0-9a-fA-F]{6}")
_FONT = FONT_NAME = re.compile(r"[A-Za-z0-9 \-]{0,60}")


def apply_edit(draft: dict[str, Any], edit: dict[str, Any], *, same_site: Any) -> dict[str, Any]:
    """Merge the setup form into the draft. ``same_site(url) -> str`` normalises a feature page and
    refuses one that isn't on the product's site."""
    brand = dict(draft.get("brand") or {})
    for k, v in (edit.get("brand") or {}).items():
        if k not in BRAND_KEYS or not isinstance(v, str) or not v.strip():
            continue  # a field left empty keeps what was there
        if k == "font":
            if not _FONT.fullmatch(v.strip()):
                raise BadInputError("a font name has only letters, digits, spaces and dashes")
            brand[k] = v.strip()
        elif not _HEX.fullmatch(v.strip()):
            raise BadInputError(f"{k} must be a colour like #1A2B3C")
        else:
            brand[k] = v.strip().lower()
    draft["brand"] = brand
    if "style" in edit:
        if edit["style"] not in OFFERED:
            raise BadInputError(PICK_A_STYLE)
        draft["style"] = edit["style"]
    if "length" in edit:
        if edit["length"] not in ("short", "medium", "long"):
            raise BadInputError("the length is 30-40, 60-80 or 90-120 seconds")
        style = draft.get("style")
        if edit["length"] not in lengths_for(style):
            raise BadInputError(f"{name_of(style)} needs {_lengths_words(str(style))}")
        draft["length"] = edit["length"]
    elif "style" in edit and draft.get("length", "short") not in lengths_for(draft["style"]):
        draft["length"] = lengths_for(draft["style"])[0]  # the shortest length the new style allows
    story = draft.get("story")
    if "style" in edit and isinstance(story, dict) and story.get("style") not in (None, edit["style"]):
        # a story whose parts are the same (one problem style for another) simply follows the new style
        same = [p.id for p in parts_for(story.get("style"))] == [p.id for p in parts_for(edit["style"])]
        if same and edit["style"] != AUTO:
            story["style"] = edit["style"]
    if "kind" in edit:
        if edit["kind"] not in ("product", "feature"):
            raise BadInputError("a video is about the whole product or one feature")
        draft["kind"] = edit["kind"]
    if "feature" in edit:
        f = edit.get("feature") or {}
        name, details = str(f.get("name") or "").strip(), str(f.get("details") or "").strip()
        url = str(f.get("url") or "").strip()
        if len(name) > 80 or len(details) > 1200:
            raise BadInputError("keep the feature's name under 80 characters and its notes under 1,200")
        draft["feature"] = {"name": name, "details": details, "url": same_site(url) if url else ""}
    if "about" in edit:
        draft["about"] = clean_about(edit.get("about") or {})
    if "notes" in edit:
        notes = {str(k): str(v).strip()[:300] for k, v in (edit.get("notes") or {}).items()}
        for s in draft.get("screenshots", []):
            if s["id"] in notes:
                s["note"] = notes[s["id"]]
    return draft


def ready_to_start(draft: dict[str, Any]) -> str | None:
    """Why the video can't start yet, or ``None``."""
    from launchframe_video.story import BadStoryError, off_length, validate_story

    if draft.get("state") == "fetching":
        return "still reading the site"
    if draft.get("storyState") == "writing":
        return "still writing the story"
    if draft.get("kind") == "feature" and not (draft.get("feature") or {}).get("name"):
        return "name the feature the video is about"
    style = draft.get("style")
    if draft.get("length", "short") not in lengths_for(style):
        return f"{name_of(style)} needs {_lengths_words(str(style))}"
    story = draft.get("story")
    if story is not None:
        theirs = story.get("style") if isinstance(story, dict) else None
        if style is not None and style != AUTO and theirs != style:
            return (
                f"the story was written for {name_of(theirs) or 'no style'}, not {name_of(style)}: "
                f"write it again, or arrange it as {structure_line(style)}"
            )
        try:
            validate_story(story)
        except BadStoryError as e:
            return f"the story: {e}"
        off = off_length(story, str(draft.get("length", "short")))
        if off is not None:
            return f"the story: {off}"
    return None


def set_story(run_dir: Path, raw: Any) -> dict[str, Any]:
    """Save the person's version of the story (it may still be half-written)."""
    from launchframe_video.story import BadStoryError, validate_story

    draft = load_draft(run_dir) or {}
    if isinstance(raw, dict) and raw.get("style") is None:  # sent without its style: it keeps the one it has
        old = draft.get("story")
        style = old.get("style") if isinstance(old, dict) and "style" in old else draft.get("style")
        if style is not None:
            raw = {**raw, "style": style}
    try:
        story = validate_story(raw, complete=False)
    except BadStoryError as e:
        raise BadInputError(str(e)) from e
    if draft.get("storyState") == "writing":
        raise BadInputError("the story is still being written")
    uploaded = {im["id"]: im for im in draft.get("sceneImages", [])}
    for i, scene in enumerate(story["scenes"], 1):
        for im in scene["images"]:
            if im["id"] not in uploaded:
                raise BadInputError(f"scene {i}: an image isn't one of the uploaded ones")
            im["kind"] = uploaded[im["id"]]["kind"]
    draft.update(story=story, storyState="ready", storyError=None)
    save_draft(run_dir, draft)
    return draft


def update_story(run_dir: Path, **fields: Any) -> dict[str, Any]:
    """Change only the story fields, on the latest draft (the person may have changed the rest meanwhile)."""
    draft = load_draft(run_dir) or {}
    draft.update(fields)
    save_draft(run_dir, draft)
    return draft


# ---------------------------------------------------------------- uploads

# An uploaded SVG logo is drawn by the renderer's Chrome, so it may only hold plain drawing: these elements,
# no event handlers, no styles that load anything, links only to its own #fragments.
_SVG_TAGS: Final = frozenset(
    [
        "svg",
        "g",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "defs",
        "lineargradient",
        "radialgradient",
        "stop",
        "clippath",
        "mask",
        "pattern",
        "symbol",
        "use",
        "title",
        "desc",
    ]
)
_SVG_LOCAL_URL = re.compile(r"url\(#[A-Za-z0-9_\-.:]+\)")
_SVG_TRANSFORM = re.compile(r"[A-Za-z0-9\s,.\-+()]*")
_SVG_TRANSFORMS = frozenset({"transform", "gradienttransform", "patterntransform"})


def _svg_value_ok(name: str, value: str) -> bool:
    """No styles at all, no escapes; brackets only in transforms or ``url(#own-id)``."""
    if name == "style" or "\\" in value or "&" in value:
        return False
    if name in _SVG_TRANSFORMS:
        return bool(_SVG_TRANSFORM.fullmatch(value))
    rest = _SVG_LOCAL_URL.sub("", value)
    return (
        "(" not in rest and ":" not in rest
    )  # no url(...) to anywhere, no scheme (http:, data:, javascript:)


def _svg_is_plain(data: bytes) -> bool:
    text = data.decode("utf-8", errors="replace")
    if re.search(r"<!(DOCTYPE|ENTITY)|<\?xml-stylesheet", text, re.I):
        return False  # no entities (expansion bombs) and no outside stylesheets
    try:
        root = ElementTree.fromstring(text)  # noqa: S314 - entities refused above
    except ElementTree.ParseError:
        return False
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1].lower() if isinstance(el.tag, str) else ""
        if tag not in _SVG_TAGS:
            return False
        for key, value in el.attrib.items():
            name = key.rsplit("}", 1)[-1].lower()
            if name.startswith("on") or not _svg_value_ok(name, value):
                return False
            if name == "href" and not value.strip().startswith("#"):
                return False
    return True


def image_kind(data: bytes, *, allow_svg: bool) -> str:
    """The file's real type from its first bytes (``png``, ``jpg``, ``webp`` or ``svg``), or
    :class:`BadInputError`."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if allow_svg:
        head = data[:2000].decode("utf-8", errors="replace").lstrip("﻿ \r\n\t").lower()
        if head.startswith(("<svg", "<?xml")) and "<svg" in head:
            if not _svg_is_plain(data):
                raise BadInputError(
                    "that SVG has scripts, styles or outside links; export it plain, or use a PNG"
                )
            return "svg"
    raise BadInputError("use a PNG, JPG or WebP image" + (" (or an SVG)" if allow_svg else ""))


def save_logo(run_dir: Path, data: bytes) -> dict[str, Any]:
    if len(data) > MAX_LOGO_BYTES:
        raise BadInputError("the logo must be under 2 MB")
    ext = image_kind(data, allow_svg=True)
    draft = load_draft(run_dir) or {}
    d = inputs_dir(run_dir)
    for old in d.glob("logo.*"):
        old.unlink()
    (d / f"logo.{ext}").write_bytes(data)
    draft["logo"] = {"file": f"logo.{ext}", "source": "upload"}
    save_draft(run_dir, draft)
    return draft


def remove_logo(run_dir: Path) -> dict[str, Any]:
    draft = load_draft(run_dir) or {}
    for old in inputs_dir(run_dir).glob("logo.*"):
        old.unlink()
    draft["logo"] = None
    save_draft(run_dir, draft)
    return draft


def add_screenshot(run_dir: Path, data: bytes, note: str = "") -> dict[str, Any]:
    draft = load_draft(run_dir) or {}
    shots = draft.setdefault("screenshots", [])
    if len(shots) >= MAX_SCREENSHOTS:
        raise BadInputError(f"up to {MAX_SCREENSHOTS} screenshots")
    if len(data) > MAX_IMAGE_BYTES:
        raise BadInputError("each screenshot must be under 8 MB")
    ext = image_kind(data, allow_svg=False)
    sid = uuid.uuid4().hex[:10]
    d = inputs_dir(run_dir) / "screenshots"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{sid}.{ext}").write_bytes(data)
    shots.append({"id": sid, "file": f"screenshots/{sid}.{ext}", "note": note.strip()[:300]})
    save_draft(run_dir, draft)
    return draft


def remove_screenshot(run_dir: Path, sid: str) -> dict[str, Any]:
    draft = load_draft(run_dir) or {}
    keep = []
    for s in draft.get("screenshots", []):
        if s["id"] == sid:
            (inputs_dir(run_dir) / s["file"]).unlink(missing_ok=True)
        else:
            keep.append(s)
    draft["screenshots"] = keep
    save_draft(run_dir, draft)
    return draft


def add_scene_image(run_dir: Path, data: bytes, kind: str) -> dict[str, Any]:
    """Keep an image the person will attach to a story scene: ``product`` (a screen of their product, a
    reference the video redesigns) or ``other`` (shown as it is: a press quote, a chart). Returns the
    image (``id``, ``kind``, ``file``); the story's scenes refer to it by id."""
    if kind not in ("product", "other"):
        raise BadInputError("an image is a product screen or another image")
    draft = load_draft(run_dir) or {}
    images = draft.setdefault("sceneImages", [])
    if len(images) >= MAX_SCENE_IMAGE_FILES:
        raise BadInputError(f"up to {MAX_SCENE_IMAGE_FILES} story images; remove one first")
    if len(data) > MAX_IMAGE_BYTES:
        raise BadInputError("each image must be under 8 MB")
    ext = image_kind(data, allow_svg=kind == "other")
    iid = uuid.uuid4().hex[:10]
    d = inputs_dir(run_dir) / "scenes"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{iid}.{ext}").write_bytes(data)
    image = {"id": iid, "kind": kind, "file": f"scenes/{iid}.{ext}"}
    images.append(image)
    save_draft(run_dir, draft)
    return image


def remove_scene_image(run_dir: Path, iid: str) -> dict[str, Any]:
    """Delete a story image, and take it off any scene that used it."""
    draft = load_draft(run_dir) or {}
    keep = []
    for im in draft.get("sceneImages", []):
        if im["id"] == iid:
            (inputs_dir(run_dir) / im["file"]).unlink(missing_ok=True)
        else:
            keep.append(im)
    draft["sceneImages"] = keep
    for scene in (draft.get("story") or {}).get("scenes", []):
        scene["images"] = [im for im in scene.get("images") or [] if im.get("id") != iid]
    save_draft(run_dir, draft)
    return draft


def input_file(run_dir: Path, name: str) -> Path | None:
    """A logo, screenshot or the site's hero capture by its name in the draft, for the setup page."""
    draft = load_draft(run_dir) or {}
    allowed = {(draft.get("logo") or {}).get("file")} | {s["file"] for s in draft.get("screenshots", [])}
    allowed |= {im["file"] for im in draft.get("sceneImages", [])}
    allowed.add("out/capture/1-hero.jpg")
    if name not in allowed:
        return None
    p = inputs_dir(run_dir) / name
    return p if p.is_file() and not p.is_symlink() else None


# ---------------------------------------------------------------- to the agent


def hand_over(run_dir: Path, work: Path) -> dict[str, Any] | None:
    """Copy the confirmed brand, logo and screenshots into ``work/inputs/`` for the agent. Returns the
    draft, or ``None`` when the video was started without one (straight from a URL)."""
    draft = load_draft(run_dir)
    if draft is None:
        return None
    src, dst = inputs_dir(run_dir), work / INPUTS
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "brand.json").write_text(json.dumps(draft.get("brand") or {}, indent=2))
    logo = draft.get("logo")
    if logo and (src / logo["file"]).is_file():
        shutil.copyfile(src / logo["file"], dst / logo["file"])
    if draft.get("story"):
        from urllib.parse import urlsplit

        from launchframe_video.story import storyboard_md

        host = (urlsplit(str(draft.get("url", ""))).hostname or "the product").removeprefix("www.")
        files = _hand_over_scene_images(draft, src, dst)
        (work / "STORYBOARD.md").write_text(storyboard_md(draft["story"], product=host, image_files=files))
    shots = [s for s in draft.get("screenshots", []) if (src / s["file"]).is_file()]
    if shots:
        (dst / "screenshots").mkdir(exist_ok=True)
        for s in shots:
            shutil.copyfile(src / s["file"], dst / s["file"])
        (dst / "screenshots.json").write_text(
            json.dumps([{"file": s["file"], "note": s.get("note", "")} for s in shots], indent=2)
        )
    return draft


def _hand_over_scene_images(draft: dict[str, Any], src: Path, dst: Path) -> dict[str, str]:
    """Copy each image a story scene uses to ``inputs/scenes/<scene number>/``; returns id → path in the
    video folder (only images that exist and are used)."""
    uploaded = {im["id"]: im for im in draft.get("sceneImages", [])}
    out: dict[str, str] = {}
    for n, scene in enumerate(draft["story"].get("scenes", []), 1):
        for ref in scene.get("images") or []:
            im = uploaded.get(ref.get("id"))
            if im is None or not (src / im["file"]).is_file() or (src / im["file"]).is_symlink():
                continue
            d = dst / "scenes" / str(n)
            d.mkdir(parents=True, exist_ok=True)
            name = Path(im["file"]).name
            shutil.copyfile(src / im["file"], d / name)
            out[im["id"]] = f"{INPUTS}/scenes/{n}/{name}"
    return out


