"""The local server: the free edition's page and the ``/api`` calls its screens make, with the hosted app's
request and response shapes (``schemas/openapi.json``), plus a few of its own (the key, opening
the video's folder). It serves one person on their own computer and listens on 127.0.0.1 only."""

from __future__ import annotations

import asyncio
import contextlib
import functools
import json
import logging
import os
import secrets
import shutil
import threading
import time
import webbrowser
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Final, Literal

import uvicorn
from fastapi import FastAPI, File, Form, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from clapper_local import security
from clapper_local.keys import BadKeyError, KeyRejectedError, KeyStore, default_env_file
from clapper_local.runs import MODEL, Engine, RealEngine, Runner, root_dir
from clapper_local.store import ACTIVE, AGENT_MODES, TERMINAL, Store
from launchframe_video import changes, edition, inputs, story, styles
from launchframe_video.files import VIDEO, NotPublicError, read_stages
from launchframe_video.stages import summary

HOST: Final = security.HOST
PORT: Final = 4317
LENGTHS: Final = ("short", "medium")
EXPECTED_MIN: Final = {"short": (15, 30), "medium": (30, 60)}
"""What a video usually takes to make on a laptop, in minutes (the page shows the same)."""
CHANGE_MIN: Final = {"fix": (3, 10), "restore": (1, 1), "prepare": (1, 1)}
MAX_UPLOAD: Final = 8 * 1024 * 1024
SSE_MAX_S: Final = 600.0
CONSOLE_LOGGERS: Final = ("", "uvicorn", "uvicorn.error", "uvicorn.access")
"""The loggers whose handlers print or write (the root's, which holds clapper.log's, and uvicorn's)."""

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


# ---------------------------------------------------------------- request bodies


class DraftIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str = Field(min_length=1, max_length=2000)
    kind: Literal["product"] = "product"  # the free edition makes product videos only
    length: Literal["short", "medium"] = "short"
    style: str = "auto"  # ignored: the style is picked at random (Pile, Tangle or Dilemma)
    story: Literal["write", "manual", "none"] = "write"
    productProblem: str = Field("", max_length=600)
    productSolution: str = Field("", max_length=600)


class SetupIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kind: Literal["product"] | None = None
    length: Literal["short", "medium"] | None = None
    about: dict[str, str] | None = None
    brand: dict[str, str] | None = None
    notes: dict[str, str] | None = None


class KeyIn(BaseModel):
    key: str = Field(max_length=400)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=changes.MAX_CHAT)


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


# ---------------------------------------------------------------- the app

SCENE_KEYS: Final = frozenset({"name", "beat", "seconds", "onScreen", "motion", "camera", "vo", "images"})
IMAGE_KEYS: Final = frozenset({"id", "kind", "note"})


def free_story(body: Any) -> Any:
    """The story as the person sent it, keeping only what a free edition's scene holds (anything the hosted
    app adds to a scene or an image is left out, never passed on)."""
    if not isinstance(body, dict) or not isinstance(body.get("scenes"), list):
        return body
    scenes = []
    for sc in body["scenes"]:
        if isinstance(sc, dict):
            sc = {k: v for k, v in sc.items() if k in SCENE_KEYS}
            if isinstance(sc.get("images"), list):
                sc["images"] = [
                    {k: v for k, v in im.items() if k in IMAGE_KEYS} if isinstance(im, dict) else im
                    for im in sc["images"]
                ]
        scenes.append(sc)
    return {**body, "scenes": scenes}


def web_dir() -> Path | None:
    """The free page's build: ``CLAPPER_WEB_DIR``, the public repo's ``app/web``, or the private repo's
    ``frontend/dist-free``."""
    if os.environ.get("CLAPPER_WEB_DIR"):
        return Path(os.environ["CLAPPER_WEB_DIR"])
    with contextlib.suppress(RuntimeError):
        root = root_dir()
        for d in (root / "app" / "web", root / "frontend" / "dist-free"):
            if (d / "index.html").is_file():
                return d
    return None


def default_home() -> Path:
    return Path(os.environ.get("CLAPPER_HOME") or Path.home() / "Clapper")


def create_app(
    *,
    home: Path | None = None,
    env_file: Path | None = None,
    engine: Engine | None = None,
    sse_poll_s: float = 0.5,
    web: Path | None = None,
    port: int | None = None,
    dev_origin: str | None = None,
    token: str | None = None,
) -> FastAPI:
    """``port``: where the server listens (``CLAPPER_PORT``, else 4317), so only its own page may call it;
    ``dev_origin``: one more page allowed, for development (``CLAPPER_DEV_ORIGIN``, e.g. Vite's; open
    ``http://127.0.0.1:<port>/?token=…`` once first so the browser holds the cookie for 127.0.0.1);
    ``token``: this launch's pass (a random one when not given: ``app.state.token``)."""
    token = token or secrets.token_urlsafe(32)
    home = home or default_home()
    port = port if port is not None else int(os.environ.get("CLAPPER_PORT") or PORT)
    dev_origin = dev_origin if dev_origin is not None else os.environ.get("CLAPPER_DEV_ORIGIN")
    store = Store(home)
    keys = KeyStore(env_file or default_env_file())
    eng: Engine = engine if engine is not None else RealEngine(home)
    runner = Runner(store, keys, eng)
    store.recover()  # nothing resumes on its own after a restart
    handler = logging.FileHandler(home / "clapper.log")
    key_filter = security.RedactFilter(keys.load)
    handler.addFilter(key_filter)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    web = web or web_dir()

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        logging.getLogger().addHandler(handler)
        # The key is cut out at the handlers, not the loggers: a logger's filter sees only the records logged
        # on that very logger, never its children's ("launchframe_video.story") on their way up. So every
        # handler that writes somewhere gets it: clapper.log, the root logger's, and uvicorn's console ones
        # (where an unhandled error's traceback is printed).
        filtered = [h for name in CONSOLE_LOGGERS for h in logging.getLogger(name).handlers]
        for h in filtered:
            h.addFilter(key_filter)
        try:
            yield
        finally:
            await asyncio.to_thread(runner.stop)
            logging.getLogger().removeHandler(handler)
            for h in filtered:
                h.removeFilter(key_filter)
            handler.close()

    app = FastAPI(
        title="Clapper Open Source", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None
    )
    app.add_middleware(security.LaunchPass, token=token, cookie=security.cookie_name(port))
    app.add_middleware(security.LocalOnly, origins=security.own_origins(port, dev_origin))  # checked first
    redact = runner.redact

    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError) -> JSONResponse:
        return _err(e.status, e.code, redact(e.message))

    @app.exception_handler(RequestValidationError)
    async def bad_request(_: Request, e: RequestValidationError) -> JSONResponse:
        # never the values sent (a pasted key could be one): only where and what is wrong
        first = e.errors()[0] if e.errors() else {}
        where = ".".join(str(x) for x in first.get("loc", ())[1:]) or "the request"
        return _err(422, "invalid", f"{where}: {first.get('msg', 'not valid')}")

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, e: StarletteHTTPException) -> JSONResponse:
        return _err(e.status_code, "error", str(e.detail))

    # ---------------------------------------------------------------- helpers

    def run_dir(vid: str) -> Path:
        if not store.exists(vid):
            raise ApiError(404, "not_found", "video not found")
        return store.video_dir(vid)

    def draft_of(vid: str) -> tuple[Path, dict[str, Any]]:
        d = run_dir(vid)
        if not store.startable(vid):
            raise ApiError(409, "video_started", "the video has started; its setup can't change now")
        draft = inputs.load_draft(d)
        if draft is None:
            raise ApiError(404, "not_found", "video setup not found")
        return d, draft

    def need_key() -> None:
        if not keys.load():
            raise ApiError(409, "no_key", "Add your Claude key in Settings first.")

    def parts(style: str | None) -> list[dict[str, Any]]:
        return [
            {"id": p.id, "label": p.label, "hint": p.hint, "required": p.required, "share": p.share}
            for p in styles.parts_for(style)
        ]

    def style_choices() -> list[dict[str, Any]]:
        return [
            {
                "id": s,
                "name": styles.name_of(s),
                "tag": styles.TAGS[s],
                "blurb": styles.STYLES[s].blurb,
                "lengths": [x for x in LENGTHS if x in styles.lengths_for(s)],
                "minSeconds": styles.min_seconds(s),
                "parts": parts(s),
            }
            for s in edition.FREE_STYLES
        ]

    def setup_out(vid: str, draft: dict[str, Any]) -> dict[str, Any]:
        base = f"/api/videos/{vid}/inputs/"
        fonts = eng.fonts()
        draft = inputs.settle_font(json.loads(json.dumps(draft)), fonts)
        logo = draft.get("logo")
        raw = draft.get("story")
        sty = story.story_style(raw) if raw else None
        out_story = None
        if isinstance(raw, dict):
            out_story = {"style": sty, "scenes": raw.get("scenes", [])}
        return {
            "model": MODEL,  # always the paid app's model: nobody picks one
            "credits": None,
            "length": draft.get("length", "short"),
            "style": draft.get("style"),
            "styleChoices": [],  # nobody chooses a style in the free edition
            "parts": parts(sty if raw else draft.get("style")),
            "storyStyleName": styles.name_of(sty) if raw and sty else "",
            "sceneImages": [
                {"id": im["id"], "kind": im["kind"], "url": base + im["file"]}
                for im in draft.get("sceneImages", [])
            ],
            "fontChoices": fonts,
            "siteFont": draft.get("siteFont", ""),
            "story": out_story,
            "storyState": draft.get("storyState", "none"),
            "storyError": draft.get("storyError"),
            "storyNotice": draft.get("storyNotice"),
            "longLines": [],
            "state": draft.get("state", "failed"),
            "error": draft.get("error"),
            "kind": "product",
            "feature": {"name": "", "details": "", "url": ""},
            "about": draft.get("about") or {"problem": "", "solution": ""},
            "brand": {k: str((draft.get("brand") or {}).get(k, "")) for k in inputs.BRAND_KEYS},
            "fetched": {k: str((draft.get("fetched") or {}).get(k, "")) for k in inputs.BRAND_KEYS},
            "logoUrl": base + logo["file"] if logo else None,
            "logoSource": logo.get("source") if logo else None,
            "heroUrl": base + "out/capture/1-hero.jpg" if draft.get("state") == "ready" else None,
            "screenshots": [
                {"id": s["id"], "url": base + s["file"], "note": s.get("note", "")}
                for s in draft.get("screenshots", [])
            ],
        }

    def seconds_between(a: str | None, b: str | None) -> float:
        if not a:
            return 0.0
        start = datetime.fromisoformat(a.replace("Z", "+00:00"))
        end = datetime.fromisoformat(b.replace("Z", "+00:00")) if b else datetime.now(UTC)
        return max(0.0, (end - start).total_seconds())

    def progress(job: dict[str, Any]) -> dict[str, Any] | None:
        if job["status"] == "queued":
            return None
        d = store.video_dir(job["videoId"])
        elapsed = seconds_between(job["startedAt"], job["finishedAt"])
        done = job["status"] == "succeeded"
        if job["mode"] == "make":
            length = str(store.meta(job["videoId"]).get("length", "short"))
            return summary(
                read_stages(d), elapsed, finished=done, expected=EXPECTED_MIN.get(length, (15, 30))
            )
        state = changes.read_change_stages(d, job["id"])
        first = {"fix": "request", "restore": "restore", "prepare": "prepare"}.get(job["mode"], "request")
        return summary(
            state, elapsed, finished=done, expected=CHANGE_MIN.get(job["mode"], (1, 3)), first=first
        )

    def row(vid: str) -> dict[str, Any]:
        meta = store.meta(vid)
        made = store.made_by(vid)
        return {
            "projectId": vid,
            "title": meta.get("title", ""),
            "url": meta.get("url", ""),
            "status": made["status"] if made else "draft",
            "createdAt": meta.get("createdAt", ""),
            "minutes": (made.get("output") or {}).get("minutes") if made else None,
            "credits": None,
        }

    def video_out(vid: str) -> dict[str, Any]:
        d = run_dir(vid)
        meta = store.meta(vid)
        made = store.made_by(vid)
        base = {**row(vid), "kind": "product", "featureName": "", "featureUrl": "", "notify": None}
        length = meta.get("length") if meta.get("length") in LENGTHS else None
        if made is None:
            draft = inputs.load_draft(d) or {}
            return {
                **base,
                "jobId": None,
                "setup": setup_out(vid, draft),
                "run": None,
                "error": None,
                "videoUrl": None,
                "summary": "",
                "version": None,
                "change": None,
                "length": length,
                "queuePosition": None,
            }
        ok = made["status"] == "succeeded" and (d / VIDEO).is_file()
        later = [j for j in store.jobs(vid) if j["mode"] in AGENT_MODES and j["id"] != made["id"]]
        change = None
        if later:
            last = later[-1]
            change = {
                "jobId": last["id"],
                "mode": last["mode"],
                "status": last["status"],
                "run": progress(last),
                "error": last["error"],
            }
        return {
            **base,
            "jobId": made["id"],
            "setup": None,
            "run": progress(made),
            "error": made["error"],
            "videoUrl": f"/api/videos/{vid}/file" if ok else None,
            "summary": str((made.get("output") or {}).get("summary") or ""),
            "version": (changes.versions(d)["current"] or None) if ok else None,
            "change": change,
            "length": length,
            "queuePosition": runner.position(made["id"]) if made["status"] == "queued" else None,
        }

    def job_out(job: dict[str, Any]) -> dict[str, Any]:
        run = progress(job) if job["mode"] in AGENT_MODES else None
        pct = run["percent"] if run else (100 if job["status"] == "succeeded" else 0)
        stage = {"queued": "pending", "running": "running", "succeeded": "done"}.get(job["status"], "failed")
        label = {"make": "Making the video", "read": "Reading the site", "story": "Writing the story"}.get(
            job["mode"], "Changing the video"
        )
        return {
            "id": job["id"],
            "projectId": job["videoId"],
            "kind": "video",
            "status": job["status"],
            "progress": int(pct),
            "stages": [{"id": "video", "label": label, "status": stage}],
            "output": job["output"],
            "error": job["error"],
            "priority": 0,
            "queuePosition": runner.position(job["id"]) if job["status"] == "queued" else None,
            "etaSeconds": None,
            "startedAt": job["startedAt"],
            "finishedAt": job["finishedAt"],
            "createdAt": job["createdAt"],
            "updatedAt": job["updatedAt"],
        }

    def made_video(vid: str) -> Path:
        """The made video, ready for a change: 409 while it isn't made or another run is going."""
        d = run_dir(vid)
        made = store.made_by(vid)
        if made is None or made["status"] != "succeeded" or not (d / VIDEO).is_file():
            raise ApiError(409, "not_made", "the video isn't made yet")
        if any(j["status"] in ACTIVE for j in store.jobs(vid) if j["mode"] in AGENT_MODES):
            raise ApiError(409, "busy", "another change is still running; wait for it to finish")
        return d

    async def read_upload(file: UploadFile, limit: int = MAX_UPLOAD) -> bytes:
        data = await file.read(limit + 1)
        if len(data) > limit:
            raise ApiError(422, "too_big", "that file is too big")
        return data

    def bad_input(fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except inputs.BadInputError as e:
            raise ApiError(422, "invalid_setup", str(e)) from e

    async def check_key(key: str) -> None:
        """One tiny call to Claude with ``key``: 400 when Claude refuses it, 502 when the check itself
        breaks (no connection, say), always as plain JSON with the key cut out."""
        try:
            await asyncio.to_thread(eng.check_key, key)
        except KeyRejectedError as e:
            raise ApiError(400, "key_rejected", security.redact(str(e), key)) from None
        except Exception as e:
            log.warning("checking the key failed: %s", security.redact(f"{type(e).__name__}: {e}", key))
            raise ApiError(
                502,
                "key_check_failed",
                f"Couldn't reach Claude to check the key ({type(e).__name__}). Check your connection and try"
                " again.",
            ) from None

    # ---------------------------------------------------------------- who and what

    @app.get("/api/auth/me")
    def me() -> dict[str, Any]:
        """A fixed local user: the free page has no accounts."""
        return {
            "user": {"id": "local", "email": "you@this-computer", "name": "You"},
            "activeWorkspaceId": "local",
            "workspaces": [
                {"id": "local", "name": "This computer", "kind": "personal", "role": "owner", "active": True}
            ],
            "googleEnabled": False,
            "isAdmin": False,
            "canAddCredits": False,
        }

    @app.get("/api/key")
    def key_state() -> dict[str, Any]:
        return keys.state()

    @app.put("/api/key")
    async def key_save(body: KeyIn) -> dict[str, Any]:
        """Check the key with one tiny call to Claude, then save it on this computer."""
        key = body.key.strip()
        if not security.KEY_PATTERN.fullmatch(key) or not key.isprintable():
            raise ApiError(
                422, "invalid_key", "That doesn't look like a Claude API key (it starts with sk-ant-)."
            )
        await check_key(key)
        try:
            keys.save(key)
        except BadKeyError as e:
            raise ApiError(422, "invalid_key", str(e)) from None
        return keys.state()

    @app.delete("/api/key")
    def key_remove() -> dict[str, Any]:
        keys.remove()
        return keys.state()

    @app.post("/api/key/test")
    async def key_test() -> dict[str, Any]:
        key = keys.load()
        if not key:
            raise ApiError(409, "no_key", "There's no key saved yet.")
        await check_key(key)
        return {"ok": True, **keys.state()}

    # ---------------------------------------------------------------- videos

    @app.get("/api/videos")
    def list_videos() -> list[dict[str, Any]]:
        return [row(vid) for vid in store.ids()]

    @app.get("/api/videos/styles")
    def list_styles() -> list[dict[str, Any]]:
        return style_choices()

    @app.post("/api/videos/drafts", status_code=201)
    async def create_draft(body: DraftIn) -> dict[str, Any]:
        """Begin a video: the site is read in the background, then the story written when asked. The style is
        Pile, Tangle or Dilemma, picked at random, whatever the request says."""
        try:
            url = await asyncio.to_thread(eng.public_url, body.url)
        except NotPublicError as e:
            raise ApiError(422, "invalid_url", str(e)) from None
        style = edition.pick_free_style()
        about = {"problem": body.productProblem, "solution": body.productSolution}
        draft = bad_input(
            lambda: inputs.new_draft(url, kind="product", about=about, story=body.story, length=body.length)
        )
        draft["style"] = style
        if body.story == "manual":
            draft["story"] = story.blank_story(body.length, style)
        if body.story == "write" and not keys.load():
            draft.update(
                storyState="failed", storyError="Add your Claude key in Settings, then write the story."
            )
        title = (url.split("//", 1)[-1].split("/", 1)[0]).removeprefix("www.")[:120]
        vid = store.create({"title": title, "url": url, "length": body.length, "style": style})
        inputs.save_draft(store.video_dir(vid), draft)
        runner.submit(vid, "read")
        return {"projectId": vid}

    @app.get("/api/videos/{vid}")
    def get_video(vid: str) -> dict[str, Any]:
        return video_out(vid)

    @app.delete("/api/videos/{vid}", status_code=204)
    def delete_video(vid: str) -> Response:
        d, _ = draft_of(vid)
        if any(j["status"] in ACTIVE for j in store.jobs(vid)):
            raise ApiError(409, "busy", "wait for the site read to finish")
        shutil.rmtree(d)
        return Response(status_code=204)

    @app.patch("/api/projects/{vid}")
    def rename(vid: str, body: TitleIn) -> dict[str, Any]:
        run_dir(vid)
        return {"title": store.set_meta(vid, title=body.title.strip())["title"]}

    @app.get("/api/videos/{vid}/setup")
    def get_setup(vid: str) -> dict[str, Any]:
        d = run_dir(vid)
        return setup_out(vid, inputs.load_draft(d) or {})

    @app.patch("/api/videos/{vid}/setup")
    def edit_setup(vid: str, body: SetupIn) -> dict[str, Any]:
        d, draft = draft_of(vid)
        edit = body.model_dump(exclude_none=True)
        edit.pop("kind", None)
        draft = bad_input(lambda: inputs.apply_edit(draft, edit, same_site=lambda u: u))
        inputs.save_draft(d, draft)
        if "length" in edit:
            store.set_meta(vid, length=edit["length"])
        return setup_out(vid, draft)

    @app.post("/api/videos/{vid}/prepare", status_code=202)
    def prepare(vid: str) -> dict[str, Any]:
        """A draft: read the site again. A video made before versions: its first version."""
        d = run_dir(vid)
        if store.startable(vid):
            draft = inputs.load_draft(d) or {}
            if draft.get("state") == "fetching" or draft.get("storyState") == "writing":
                raise ApiError(409, "busy", "still reading the site or writing the story")
            draft.update(state="fetching", error=None)
            inputs.save_draft(d, draft)
            return {"jobId": runner.submit(vid, "read")["id"]}
        made_video(vid)
        if changes.versions(d)["versions"]:
            raise ApiError(409, "ready", "this video is ready already")
        return {"jobId": runner.submit(vid, "prepare")["id"]}

    @app.post("/api/videos/{vid}/logo")
    async def upload_logo(vid: str, file: Annotated[UploadFile, File()]) -> dict[str, Any]:
        d, _ = draft_of(vid)
        data = await read_upload(file, inputs.MAX_LOGO_BYTES)
        return setup_out(vid, bad_input(lambda: inputs.save_logo(d, data)))

    @app.delete("/api/videos/{vid}/logo")
    def delete_logo(vid: str) -> dict[str, Any]:
        d, _ = draft_of(vid)
        return setup_out(vid, inputs.remove_logo(d))

    @app.post("/api/videos/{vid}/screenshots")
    async def upload_screenshot(
        vid: str, file: Annotated[UploadFile, File()], note: Annotated[str, Form()] = ""
    ) -> dict[str, Any]:
        d, _ = draft_of(vid)
        data = await read_upload(file)
        return setup_out(vid, bad_input(lambda: inputs.add_screenshot(d, data, note)))

    @app.delete("/api/videos/{vid}/screenshots/{sid}")
    def delete_screenshot(vid: str, sid: str) -> dict[str, Any]:
        d, _ = draft_of(vid)
        return setup_out(vid, inputs.remove_screenshot(d, sid))

    @app.post("/api/videos/{vid}/story/images", status_code=201)
    async def upload_scene_image(
        vid: str, file: Annotated[UploadFile, File()], kind: Annotated[str, Form()] = "product"
    ) -> dict[str, Any]:
        d, _ = draft_of(vid)
        data = await read_upload(file)
        im = bad_input(lambda: inputs.add_scene_image(d, data, kind))
        return {"id": im["id"], "kind": im["kind"], "url": f"/api/videos/{vid}/inputs/{im['file']}"}

    @app.delete("/api/videos/{vid}/story/images/{iid}")
    def delete_scene_image(vid: str, iid: str) -> dict[str, Any]:
        d, _ = draft_of(vid)
        return setup_out(vid, inputs.remove_scene_image(d, iid))

    @app.get("/api/videos/{vid}/inputs/{name:path}")
    def input_file(vid: str, name: str) -> FileResponse:
        p = inputs.input_file(run_dir(vid), name)
        if p is None:
            raise ApiError(404, "not_found", "file not found")
        return FileResponse(p)

    @app.get("/api/videos/{vid}/story")
    def get_story(vid: str) -> dict[str, Any] | None:
        out: dict[str, Any] | None = setup_out(vid, inputs.load_draft(run_dir(vid)) or {})["story"]
        return out

    @app.put("/api/videos/{vid}/story")
    async def save_story(vid: str, request: Request) -> dict[str, Any]:
        d, _ = draft_of(vid)
        try:
            body = await request.json()
        except ValueError:
            raise ApiError(422, "invalid", "the story isn't JSON") from None
        body = free_story(body)
        return setup_out(vid, bad_input(lambda: inputs.set_story(d, body)))

    @app.post("/api/videos/{vid}/story/write", status_code=202)
    def write_story(vid: str) -> dict[str, Any]:
        d, draft = draft_of(vid)
        if draft.get("state") != "ready":
            raise ApiError(409, "not_ready", "the site isn't read yet")
        if draft.get("storyState") == "writing":
            raise ApiError(409, "busy", "the story is being written")
        need_key()
        draft = inputs.update_story(d, storyState="writing", storyError=None)
        runner.submit(vid, "story")
        return setup_out(vid, draft)

    @app.post("/api/videos/{vid}/start")
    def start(vid: str) -> dict[str, Any]:
        d, draft = draft_of(vid)
        inputs.settle_font(draft, eng.fonts())
        inputs.save_draft(d, draft)
        why = inputs.ready_to_start(draft)
        if why is not None:
            raise ApiError(409, "not_ready", why)
        need_key()
        return {"projectId": vid, "jobId": runner.submit(vid, "make")["id"]}

    @app.post("/api/videos/{vid}/cancel")
    def cancel(vid: str) -> dict[str, Any]:
        run_dir(vid)
        going = [j for j in store.jobs(vid) if j["status"] in ACTIVE]
        if not going or not runner.cancel(going[-1]["id"]):
            raise ApiError(409, "job_finished", "it has already finished")
        return {"ok": True}

    @app.post("/api/videos/{vid}/open-folder")
    def open_folder(vid: str) -> dict[str, Any]:
        eng.open_folder(run_dir(vid))
        return {"ok": True}

    @app.get("/api/videos/{vid}/file")
    def video_file(vid: str, download: Annotated[bool, Query()] = False) -> FileResponse:
        d = run_dir(vid)
        p = d / VIDEO
        if p.is_symlink() or not p.is_file():
            raise ApiError(404, "not_found", "the video isn't made yet")
        name = f"{store.meta(vid).get('title') or 'video'}.mp4".replace('"', "")
        return FileResponse(
            p,
            media_type="video/mp4",
            filename=name if download else None,
            content_disposition_type="attachment" if download else "inline",
        )

    @app.get("/api/videos/{vid}/fields")
    def fields(vid: str) -> dict[str, Any] | None:
        """The made video's scenes (the player's timeline), as the server read them after the run; never
        read from the agent's folder here."""
        return changes.load_fields(run_dir(vid))

    @app.get("/api/videos/{vid}/chat")
    def chat(vid: str) -> list[dict[str, Any]]:
        return [
            {
                "role": m.get("role"),
                "text": m.get("text", ""),
                "at": m.get("at", ""),
                "version": m.get("version"),
            }
            for m in changes.load_chat(run_dir(vid))
        ]

    @app.post("/api/videos/{vid}/chat", status_code=202)
    def ask_fix(vid: str, body: ChatIn) -> dict[str, Any]:
        """Ask for a change in plain words; the agent makes it on the person's key and replies here."""
        d = made_video(vid)
        need_key()
        message = " ".join(body.message.split())
        if not message:
            raise ApiError(422, "invalid", "say what to change")
        job = runner.submit(vid, "fix", message=message)
        changes.add_chat(d, {"role": "person", "text": message, "jobId": job["id"]})
        return {"jobId": job["id"]}

    @app.get("/api/videos/{vid}/versions")
    def versions(vid: str) -> dict[str, Any]:
        idx = changes.versions(run_dir(vid))
        rows = [
            {
                "n": v["n"],
                "at": v["at"],
                "kind": v["kind"],
                "note": v.get("note", ""),
                "minutes": v.get("minutes", 0),
                "credits": 0,
                "costUsd": v.get("costUsd", 0.0),
                "url": f"/api/videos/{vid}/versions/{v['n']}/file",
            }
            for v in idx["versions"]
        ]
        return {"current": idx["current"], "versions": rows}

    @app.get("/api/videos/{vid}/versions/{n}/file")
    def version_file(vid: str, n: int) -> FileResponse:
        p = changes.version_file(run_dir(vid), n)
        if p is None:
            raise ApiError(404, "not_found", "version not found")
        return FileResponse(p, media_type="video/mp4")

    @app.post("/api/videos/{vid}/versions/{n}/restore", status_code=202)
    def restore(vid: str, n: int) -> dict[str, Any]:
        d = made_video(vid)
        idx = changes.versions(d)
        if not any(int(v["n"]) == n for v in idx["versions"]):
            raise ApiError(404, "not_found", "version not found")
        if idx["current"] == n:
            raise ApiError(409, "current", "that version is already the one shown")
        return {"jobId": runner.submit(vid, "restore", version=n)["id"]}

    # ---------------------------------------------------------------- runs

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        job = store.job(job_id)
        if job is None:
            raise ApiError(404, "not_found", "job not found")
        return job_out(job)

    @app.get("/api/jobs/{job_id}/events")
    async def job_events(job_id: str, request: Request) -> StreamingResponse:
        """Server-sent progress: ``event: job`` (the whole job) on every change, then ``event: end``."""

        async def events() -> AsyncIterator[str]:
            last = ""
            t0 = time.monotonic()
            while time.monotonic() - t0 < SSE_MAX_S:
                job = store.job(job_id)
                if job is None:
                    yield 'event: error\ndata: {"code":"not_found"}\n\n'
                    return
                payload = json.dumps(job_out(job))
                if payload != last:
                    last = payload
                    yield f"event: job\ndata: {payload}\n\n"
                if job["status"] in TERMINAL:
                    yield f"event: end\ndata: {json.dumps({'status': job['status']})}\n\n"
                    return
                if await request.is_disconnected():
                    return
                await asyncio.sleep(sse_poll_s)

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"cache-control": "no-store", "x-accel-buffering": "no"},
        )

    # ---------------------------------------------------------------- the page

    @app.get("/{path:path}", include_in_schema=False)
    def page(path: str) -> Response:
        if path.startswith("api/"):
            raise ApiError(404, "not_found", "not found")
        if web is None:
            return PlainTextResponse(
                "The page isn't built yet. Build it with: pnpm --filter ./frontend build:free",
                status_code=503,
            )
        f = (web / path).resolve()
        if path and f.is_file() and f.is_relative_to(web.resolve()):
            return FileResponse(f)
        return FileResponse(web / "index.html")

    app.state.runner = runner
    app.state.token = token
    return app


def server_config(port: int = PORT, token: str | None = None) -> uvicorn.Config:
    """Always 127.0.0.1: the server is for this computer only; nothing (no setting) changes the address."""
    return uvicorn.Config(
        functools.partial(create_app, port=port, token=token),
        factory=True,
        host=HOST,
        port=port,
        log_level="warning",
    )


def main() -> None:
    """Start the server. Launched by start.mjs, the pass comes in ``CLAPPER_TOKEN`` and start.mjs opens the
    browser; started on its own, it makes the pass and opens the browser itself. The pass is never printed,
    and is taken out of the environment so nothing the server starts inherits it."""
    port = int(os.environ.get("CLAPPER_PORT") or PORT)
    given = os.environ.pop("CLAPPER_TOKEN", None)
    token = given or secrets.token_urlsafe(32)
    print(f"Clapper Open Source: http://{HOST}:{port}")
    server = uvicorn.Server(server_config(port, token))
    if given is None:
        if os.environ.get("CLAPPER_NO_BROWSER"):
            print(
                "CLAPPER_NO_BROWSER is set, but only the browser this opens can use the page: start it with"
            )
            print(f"CLAPPER_TOKEN=<a secret of yours> and open http://{HOST}:{port}/?token=<that secret>")
        else:

            def open_page() -> None:
                for _ in range(600):
                    if server.started:
                        webbrowser.open(f"http://{HOST}:{port}/?{security.PASS_PARAM}={token}")
                        return
                    time.sleep(0.1)

            threading.Thread(target=open_page, daemon=True).start()
    server.run()
