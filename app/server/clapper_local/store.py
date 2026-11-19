"""Where everything lives: one folder per video under ``~/Clapper/videos/<id>/``.

* ``video.json``: the video (its site, title, model, length, style, when it was made);
* ``inputs/``: the setup (the site's capture, brand, logo, screenshots, the story), as in the hosted app;
* ``work/``: the kit project the agent builds in (open it in Remotion Studio);
* ``video.mp4``, ``versions/<n>/video.mp4``, ``chat.json``, ``stages.json``: what was made, written by the
  server only;
* ``jobs/<job id>.json``: each run (the first video, a fix, a restore, reading the site, writing the story);
  ``run.json``: the first video's run (its status), for the person to read.

A run that was going when the app stopped is marked stopped when it starts again: nothing resumes on its own,
so nothing is spent that the person didn't see start.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Final

from launchframe_video import changes, inputs

log = logging.getLogger(__name__)

VIDEO_ID: Final = re.compile(r"[0-9a-f]{12}")
JOB_ID: Final = re.compile(r"([0-9a-f]{12})-[0-9a-f]{8}")
META: Final = "video.json"
RUN: Final = "run.json"
JOBS: Final = "jobs"
ACTIVE: Final = ("queued", "running")
TERMINAL: Final = ("succeeded", "failed", "canceled")
AGENT_MODES: Final = ("make", "fix", "restore", "prepare")
"""Runs on the one-at-a-time agent lane; ``read`` and ``story`` (the setup) run on their own lane."""
STOPPED: Final = "Stopped: the app was closed while this was running. Start it again when you're ready."


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(path: Path, data: Any) -> None:
    """Write a file whole or not at all."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        Path(name).replace(path)
    except BaseException:
        with contextlib.suppress(OSError):
            Path(name).unlink()
        raise


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


class Store:
    def __init__(self, home: Path) -> None:
        self.home = home
        self.videos = home / "videos"
        self.videos.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    # -- videos

    def video_dir(self, vid: str) -> Path:
        if not VIDEO_ID.fullmatch(vid):
            raise KeyError(vid)
        return self.videos / vid

    def exists(self, vid: str) -> bool:
        return VIDEO_ID.fullmatch(vid) is not None and (self.videos / vid / META).is_file()

    def create(self, meta: dict[str, Any]) -> str:
        vid = uuid.uuid4().hex[:12]
        write_json(self.video_dir(vid) / META, {"id": vid, "createdAt": now(), "seq": time.time_ns(), **meta})
        return vid

    def meta(self, vid: str) -> dict[str, Any]:
        out = read_json(self.video_dir(vid) / META)
        if not isinstance(out, dict):
            raise KeyError(vid)
        return out

    def set_meta(self, vid: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            m = {**self.meta(vid), **fields}
            write_json(self.video_dir(vid) / META, m)
            return m

    def ids(self) -> list[str]:
        """Every video, newest first."""
        found = [
            (self.meta(p.name).get("createdAt", ""), p.name)
            for p in self.videos.iterdir()
            if self.exists(p.name)
        ]
        return [vid for _, vid in sorted(found, reverse=True)]

    # -- jobs

    def new_job(self, vid: str, mode: str, **input: Any) -> dict[str, Any]:
        job = {
            "id": f"{vid}-{uuid.uuid4().hex[:8]}",
            "videoId": vid,
            "mode": mode,
            "status": "queued",
            "input": input,
            "output": None,
            "error": None,
            "createdAt": now(),
            "seq": time.time_ns(),  # the order runs were asked for (createdAt is to the second)
            "updatedAt": now(),
            "startedAt": None,
            "finishedAt": None,
        }
        self._save(job)
        return job

    def _save(self, job: dict[str, Any]) -> None:
        d = self.video_dir(job["videoId"])
        write_json(d / JOBS / f"{job['id']}.json", job)
        if job["mode"] == "make":
            keep = ("id", "status", "error", "startedAt", "finishedAt")
            write_json(d / RUN, {k: job[k] for k in keep} | (job.get("output") or {}))

    def job(self, job_id: str) -> dict[str, Any] | None:
        m = JOB_ID.fullmatch(job_id)
        if m is None or not self.exists(m.group(1)):
            return None
        out = read_json(self.videos / m.group(1) / JOBS / f"{job_id}.json")
        return out if isinstance(out, dict) else None

    def update_job(self, job_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            job = self.job(job_id)
            if job is None:
                raise KeyError(job_id)
            if job["status"] in TERMINAL and fields.get("status") not in (None, job["status"]):
                return job  # an ended run stays ended
            if fields.get("status") == "running" and not job["startedAt"]:
                fields["startedAt"] = now()
            if fields.get("status") in TERMINAL:
                fields["finishedAt"] = now()
            job.update(fields, updatedAt=now())
            self._save(job)
            return job

    def jobs(self, vid: str) -> list[dict[str, Any]]:
        """The video's runs, oldest first."""
        d = self.video_dir(vid) / JOBS
        out = [read_json(p) for p in d.glob("*.json")] if d.is_dir() else []
        return sorted(
            (j for j in out if isinstance(j, dict)), key=lambda j: (j.get("seq", 0), j["createdAt"], j["id"])
        )

    def made_by(self, vid: str) -> dict[str, Any] | None:
        """The latest run that made (or tried to make) the video; none while it is a draft. A first video
        that failed or was stopped can be started again, so the newest attempt is the one that counts."""
        return next((j for j in reversed(self.jobs(vid)) if j["mode"] == "make"), None)

    def startable(self, vid: str) -> bool:
        """The video can be (re)started from its setup: never made, or its last attempt failed or was
        stopped (its story and setup are kept)."""
        made = self.made_by(vid)
        return made is None or made["status"] in ("failed", "canceled")

    # -- after a restart

    def recover(self) -> None:
        """Runs that were going when the app stopped are stopped now (a fix cut off part way is undone: the
        current version's sources go back into ``work/``); a site read or a story being written then is
        marked as not done, so the person can start it again."""
        for vid in self.ids():
            run_dir = self.video_dir(vid)
            half_done = False
            for job in self.jobs(vid):
                if job["status"] in ACTIVE:
                    half_done |= job["status"] == "running" and job["mode"] in ("fix", "restore")
                    self.update_job(job["id"], status="canceled", error=STOPPED)
            if half_done:  # a fix cut off part way: its half-made edit goes, the current version returns
                current = int(changes.versions(run_dir)["current"] or 0)
                if current:
                    try:
                        changes.restore(run_dir, current)
                    except Exception:  # the served video is untouched; the folder is as the run left it
                        log.exception("couldn't put version %s of %s back after a restart", current, vid)
            draft = inputs.load_draft(run_dir)
            if draft is None:
                continue
            if draft.get("state") == "fetching":
                draft.update(
                    state="failed", error="The app was closed while it read the site. Read it again."
                )
            if draft.get("storyState") == "writing":
                draft.update(
                    storyState="failed",
                    storyError="The app was closed while it wrote the story."
                    " Write it again, or write it here.",
                )
            inputs.save_draft(run_dir, draft)
