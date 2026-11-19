"""Where one video's files live, how to read them back, and which URLs may be made into a video (light: the
API imports this, not the agent).

``<LF_DATA_DIR>/videos/<project id>/``:

* ``work/`` — the kit copy the agent works in. The agent can write anything here (links included), so
  nothing in it is ever served or read by the API.
* ``progress.log`` (one line per agent action, for debugging), ``stages.json`` (the plain-language stages
  the page shows), ``run.json`` (the result) and ``video.mp4`` (a copy of
  ``work/out/final.mp4``, made only when that is a real file inside ``work/``) — written by the worker,
  outside the agent's reach.
"""

from __future__ import annotations

import ipaddress
import json
import os
import shutil
import socket
import stat
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final
from urllib.parse import urlsplit

PROGRESS: Final = "progress.log"
RESULT: Final = "run.json"
STAGES: Final = "stages.json"
VIDEO: Final = "video.mp4"
WORK: Final = "work"
FINAL: Final = "out/final.mp4"
"""The kit's output, relative to ``work/``."""


def video_dir(project_id: str, root: Path | None = None) -> Path:
    if root is None:
        from launchframe_jobs.config import data_root  # the hosted app's data folder

        root = data_root()
    return root / "videos" / project_id


def work_dir(project_id: str, root: Path | None = None) -> Path:
    return video_dir(project_id, root) / WORK


def read_plain(path: Path) -> str | None:
    """A regular file's text, never through a link."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None
    with os.fdopen(fd, "rb") as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
            return None
        return f.read().decode(errors="replace")


def read_result(run_dir: Path) -> dict[str, Any] | None:
    raw = read_plain(run_dir / RESULT)
    try:
        out = json.loads(raw) if raw is not None else None
    except ValueError:
        return None
    return out if isinstance(out, dict) else None


def read_stages(run_dir: Path) -> dict[str, Any]:
    """``stages.json`` as written by :class:`launchframe_video.stages.Tracker`, or ``{}``."""
    raw = read_plain(run_dir / STAGES)
    try:
        out = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    return out if isinstance(out, dict) else {}


def read_progress(run_dir: Path, last: int = 12) -> list[str]:
    raw = read_plain(run_dir / PROGRESS)
    return raw.splitlines()[-last:] if raw else []


def keep_video(run_dir: Path) -> Path | None:
    """Copy ``work/out/final.mp4`` to ``video.mp4`` when it is an MP4 and a regular file inside ``work/``
    (no symbolic link on the way, no hard link to another file); otherwise ``None``."""
    work = (run_dir / WORK).resolve()
    src = run_dir / WORK / FINAL
    p = src
    while p != run_dir:
        if p.is_symlink():
            return None
        p = p.parent
    try:
        fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None
    dst = run_dir / VIDEO
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        # a hard link to a file elsewhere has st_nlink > 1; the kit's own render has exactly one
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or not src.resolve().is_relative_to(work):
            return None
        if f.read(12)[4:8] != b"ftyp":  # an MP4 starts with its ftyp box
            return None
        f.seek(0)
        tmp = dst.with_suffix(".part")
        with tmp.open("wb") as out:
            shutil.copyfileobj(f, out)
    tmp.replace(dst)
    return dst


# ---------------------------------------------------------------- which URLs


class NotPublicError(ValueError):
    """The address is not a public web site."""


Resolver = Callable[[str], list[str]]


def resolve(host: str) -> list[str]:
    return sorted({str(info[4][0]) for info in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)})


def public_url(raw: str, resolver: Resolver | None = None) -> str:
    """``raw`` as a normalised http(s) URL whose host resolves only to public addresses, or
    :class:`NotPublicError`. The capture and the agent's fetches reach whatever this names, so hosts on
    this machine or a private network are refused; resolving catches every spelling of them
    (``0x7f.1``, ``localhost.``, a name pointing at 10.x)."""
    t = raw.strip()
    if "://" not in t:
        t = f"https://{t}"
    parts = urlsplit(t)
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme.lower() not in ("http", "https") or "." not in host or parts.username or parts.password:
        raise NotPublicError("that is not a web address")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise NotPublicError("use the site's domain name, not an IP address")
    try:
        addrs = (resolver or resolve)(host)
    except OSError as e:
        raise NotPublicError("that site could not be found") from e
    if not addrs or not all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs):
        raise NotPublicError("that address is not on the public web")
    return parts._replace(scheme=parts.scheme.lower(), netloc=parts.netloc.lower()).geturl()
