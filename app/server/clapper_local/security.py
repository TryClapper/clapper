"""What keeps the local server and its agent safe.

* The server answers this computer only: it listens on 127.0.0.1, and a request whose ``Host`` or ``Origin``
  names anything else is refused (a web page the person visits can't drive it, nor a DNS name rebound to
  127.0.0.1).
* ...and only the browser it opened: each launch makes a random pass, opens the page with it in the link
  once, and the page trades it for an HttpOnly, SameSite=Strict cookie that every request must then carry
  (another program on this computer can reach 127.0.0.1 too, and the API spends the person's key).
* The Claude key is cut out of any text that might carry it (errors, logs) before it is kept or shown.
* The agent works only inside its video folder: file tools there (plus reading the kit's shared packages),
  web fetches only on the product's own site, and shell commands only from a short list (``node`` and ``npx``
  for the kit's scripts and Remotion, ``python3`` for the kit's scripts, ``ffmpeg``), run in Claude Code's OS
  sandbox. Everything else is refused. Site, story and chat text are data, never instructions.
"""

from __future__ import annotations

import fnmatch
import hmac
import json
import logging
import os
import re
import shlex
from collections.abc import Awaitable, Callable, Iterable
from pathlib import Path
from typing import Any, Final, cast
from urllib.parse import parse_qsl, urlencode, urlsplit

from claude_agent_sdk import (
    PermissionResultAllow,
    PermissionResultDeny,
    SandboxNetworkConfig,
    SandboxSettings,
    ToolPermissionContext,
)
from starlette.requests import cookie_parser
from starlette.types import ASGIApp, Receive, Scope, Send

HOST: Final = "127.0.0.1"
LOCAL_NAMES: Final = frozenset({"127.0.0.1", "localhost", "[::1]", "::1"})

# ---------------------------------------------------------------- this computer only


def _host_of(value: str) -> str:
    """``localhost:4317`` → ``localhost``; ``[::1]:4317`` → ``[::1]``."""
    v = value.strip().lower()
    if v.startswith("["):
        return v[: v.find("]") + 1] if "]" in v else v
    return v.rsplit(":", 1)[0] if v.count(":") == 1 else v


def local_host(value: str) -> bool:
    return _host_of(value) in LOCAL_NAMES


def local_origin(value: str) -> bool:
    parts = urlsplit(value.strip())
    return parts.scheme in ("http", "https") and local_host(parts.netloc)


def own_origins(port: int, dev_origin: str | None = None) -> frozenset[str]:
    """The pages allowed to call the server: its own page on this port (by either local name) and, when
    set, the one development page (``CLAPPER_DEV_ORIGIN``, e.g. Vite's). Never any other local port: a page
    served from one (a render's own preview server, another app) could otherwise drive this one."""
    out = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
    if dev_origin and local_origin(dev_origin):
        out.add(dev_origin.strip().rstrip("/").lower())
    return frozenset(out)


UPLOADS: Final = re.compile(r"/api/videos/[^/]+/(logo|screenshots|story/images)")
"""The routes that take a file (multipart); every other route with a body takes JSON."""
_BODY_METHODS: Final = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _body_type_ok(method: str, path: str, headers: dict[str, str]) -> bool:
    """A request with a body names its type: JSON (or a file upload on the upload routes). A page on
    another origin can only send JSON after a preflight, which this server never answers, so a form or a
    plain-text post from elsewhere is refused here even if it got past the origin check."""
    has_body = headers.get("content-length", "0") not in ("", "0") or "transfer-encoding" in headers
    if method not in _BODY_METHODS or not has_body:
        return True
    kind = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if UPLOADS.fullmatch(path):
        return kind == "multipart/form-data"
    return kind == "application/json"


class LocalOnly:
    """Refuse (403) any request whose ``Host`` isn't this computer, or that comes from a page other than
    the app's own (its ``Origin``); refuse (415) a body that isn't JSON (or a file on the upload routes).
    Requests with no ``Origin`` (the browser's own same-origin loads, curl) pass the origin check."""

    def __init__(self, app: ASGIApp, origins: frozenset[str] = frozenset()) -> None:
        self.app = app
        self.origins = origins

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
            origin = headers.get("origin")
            ok = local_host(headers.get("host", "")) and (
                origin is None or origin.strip().rstrip("/").lower() in self.origins
            )
            if not ok:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                    return
                await _refuse(send, 403, "forbidden", "This app only answers this computer.")
                return
            if scope["type"] == "http" and not _body_type_ok(scope["method"], scope["path"], headers):
                await _refuse(send, 415, "unsupported_media_type", "Send JSON (or a file upload).")
                return
        await self.app(scope, receive, send)


def cookie_name(port: int) -> str:
    """The launch's cookie: named by port, since a browser shares 127.0.0.1's cookies across ports."""
    return f"clapper_{port}"


PASS_PARAM: Final = "token"  # noqa: S105 (the name of the link's query parameter, not a secret)
COOKIE_DAYS: Final = 30
NO_PASS_PAGE: Final = (
    b"<!doctype html><meta charset=utf-8><title>Clapper</title>"
    b"<p style='font:16px system-ui;margin:3em auto;max-width:32em'>Open Clapper from the link it opened in "
    b"your browser when it started (run <code>node app/start.mjs</code> again if it isn't running).</p>"
)


class LaunchPass:
    """Refuse (403) any request without this launch's cookie. A page load (``GET``, not ``/api``) whose link
    carries the pass (``?token=``) gets the cookie and is sent on to the same page without it (303)."""

    def __init__(self, app: ASGIApp, token: str = "", cookie: str = "clapper") -> None:
        if not token:
            raise ValueError("the launch pass can't be empty")
        self.app, self.token, self.cookie = app, token.encode(), cookie

    def _is_pass(self, value: str) -> bool:
        return hmac.compare_digest(value.encode(), self.token)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        if self._is_pass(cookie_parser(headers.get("cookie", "")).get(self.cookie, "")):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        path: str = scope["path"]
        api = path == "/api" or path.startswith("/api/")
        if scope["method"] == "GET" and not api:
            query = parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True)
            given = [v for k, v in query if k == PASS_PARAM]
            if given and self._is_pass(given[0]):
                rest = urlencode([(k, v) for k, v in query if k != PASS_PARAM])
                where = path if path.startswith("/") and not path.startswith("//") else "/"
                cookie = (
                    f"{self.cookie}={self.token.decode()}; Path=/; HttpOnly; SameSite=Strict;"
                    f" Max-Age={COOKIE_DAYS * 86400}"
                )
                await send(
                    {
                        "type": "http.response.start",
                        "status": 303,
                        "headers": [
                            (b"location", (where + (f"?{rest}" if rest else "")).encode("latin-1")),
                            (b"set-cookie", cookie.encode("latin-1")),
                            (b"cache-control", b"no-store"),
                            (b"referrer-policy", b"no-referrer"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": b""})
                return
        if api:
            await _refuse(send, 403, "no_pass", "Open Clapper from the link it opened in your browser.")
            return
        await send(
            {
                "type": "http.response.start",
                "status": 403,
                "headers": [(b"content-type", b"text/html; charset=utf-8"), (b"cache-control", b"no-store")],
            }
        )
        await send({"type": "http.response.body", "body": NO_PASS_PAGE})


async def _refuse(send: Send, status: int, code: str, message: str) -> None:
    body = json.dumps({"error": {"code": code, "message": message}}).encode()
    await send(
        {"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json")]}
    )
    await send({"type": "http.response.body", "body": body})


# ---------------------------------------------------------------- the key, cut out of text

KEY_PATTERN: Final = re.compile(r"sk-ant-[A-Za-z0-9_\-]{4,}")
HIDDEN: Final = "[key hidden]"


def redact(text: str, key: str | None) -> str:
    """``text`` without the key (or anything shaped like a Claude key)."""
    if key:
        text = text.replace(key, HIDDEN)
    return KEY_PATTERN.sub(HIDDEN, text)


class RedactFilter(logging.Filter):
    """Cuts the key out of every log line (``key()`` gives the current key, if any)."""

    def __init__(self, key: Callable[[], str | None]) -> None:
        super().__init__()
        self.key = key

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if record.exc_info:
            msg += "\n" + logging.Formatter().formatException(record.exc_info)
            record.exc_info, record.exc_text = None, None
        record.msg, record.args = redact(msg, self.key()), None
        return True


# ---------------------------------------------------------------- the agent's limits

FILE_TOOLS: Final = frozenset({"Read", "Write", "Edit", "Glob", "Grep"})
KIT_TOOL: Final = "mcp__launchframe__kit"
CAPTURE_TOOL: Final = "mcp__launchframe__capture"
FREE_TOOLS: Final = frozenset({KIT_TOOL, CAPTURE_TOOL, "TodoWrite"})

COMMANDS: Final = frozenset({"node", "npx", "python3", "ffmpeg", "ffprobe", "ls", "mkdir"})
"""Shell commands the agent may run (``ls`` and ``mkdir`` only look and make folders, inside the sandbox)."""
NODE_SCRIPTS: Final = frozenset(
    {"scripts/kit.mjs", "scripts/capture.mjs", "scripts/embed-fonts.mjs", "scripts/text-check.mjs"}
)
PYTHON_SCRIPTS: Final = frozenset({"scripts/audio.py", "scripts/variant.py"})
"""The kit's own scripts, by name, run from the video folder: never a script the agent wrote."""
REMOTION_COMMANDS: Final = frozenset({"render", "still", "compositions"})
PROTECTED: Final = ("scripts", ".claude", "package.json", "package-lock.json")
PROTECTED_FILES: Final = ("tsconfig*.json", "remotion.config.*")
"""Top-level files matched by pattern (the build's configuration: it runs as code or changes what runs)."""
CONFIG_NAMES: Final = ("tsconfig.json", "remotion.config.ts", "remotion.config.js", "remotion.config.mjs")
"""Denied to the sandbox's writes even before they exist, so the agent can't create one."""
OUT_FLAGS: Final = frozenset(
    {"-o", "--out", "--output", "--outDir", "--outFile", "--declarationDir", "--tsBuildInfoFile"}
)
"""Parts of the video folder the agent may read but never change (the allowed scripts, its skill, the
packages): an allowed script name must always be the kit's script."""
_SPLIT: Final = re.compile(r"&&|\|\||[;|\n]")
_PROTOCOL: Final = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)
"""A URL-like argument (``file:/…``, ``subfile:…``, ``ftp://…``): ffmpeg and others open these themselves, so
the folder check can't see where they lead. Only http(s) pages pass (the sandbox reaches the product's site
only)."""
_NEVER: Final = ("`", "$", "<", ">")
_CONTROL: Final = ("&", "(", ")", "{", "}", "\r")
"""No substitution, variables or redirects: shell expansion would get around the path checks."""


def _inside(path: str, root: Path, also: Iterable[Path] = ()) -> bool:
    try:
        p = Path(path).expanduser()
        p = (p if p.is_absolute() else root / p).resolve()
    except (OSError, ValueError, RuntimeError):
        return False
    return any(p.is_relative_to(r.resolve()) for r in (root, *also))


def _looks_like_path(arg: str) -> bool:
    return "/" in arg or arg.startswith(("~", ".")) or arg.endswith((".mp4", ".mov", ".wav", ".mp3", ".png"))


def protected(path: str, root: Path) -> bool:
    try:
        p = Path(path).expanduser()
        p = (p if p.is_absolute() else root / p).resolve()
    except (OSError, ValueError, RuntimeError):
        return True
    r = root.resolve()
    if p.parent == r and any(fnmatch.fnmatch(p.name, pat) for pat in PROTECTED_FILES):
        return True
    return any(p == r / name or p.is_relative_to(r / name) for name in PROTECTED)


def protected_paths(root: Path) -> list[Path]:
    """What the sandbox may never write in the video folder (the OS-level side of ``protected``)."""
    r = root.resolve()
    found = [p for pat in PROTECTED_FILES for p in r.glob(pat)]
    return sorted({*(r / n for n in PROTECTED), *(r / n for n in CONFIG_NAMES), *found})


def command_ok(command: str, root: Path, kit: Path) -> str | None:
    """Why the shell command can't run, or ``None`` when every part of it is on the list and stays in
    ``root`` (the video folder)."""
    cmd = command.replace("2>&1", " ")
    if any(t in cmd for t in _NEVER):
        return "no redirects, substitutions or backticks"
    # Once the separators the gate understands are taken out, no other shell control character may remain:
    # a lone & would start the next program in the background, past the command list.
    if any(t in _SPLIT.sub(" ", cmd) for t in _CONTROL):
        return "no background jobs, subshells, groups or carriage returns"
    for part in _SPLIT.split(cmd):
        if not part.strip():
            continue
        try:
            words = shlex.split(part)
        except ValueError:
            return "a command that can't be read"
        prog, args = words[0], words[1:]
        if prog not in COMMANDS:
            return f"{prog} isn't one of the commands this run may use ({', '.join(sorted(COMMANDS))})"
        first = args[0].removeprefix("./") if args else ""
        # tsc only type-checks: it must not write anything (and reads its own config)
        typecheck = prog == "npx" and first == "tsc"
        if typecheck and ("--noEmit" not in args or {"-b", "--build"} & set(args)):
            return "npx tsc only type-checks here (npx tsc --noEmit)"
        out_next = False
        for i, raw in enumerate(args):
            flag, eq, value = raw.partition("=")
            a = value if raw.startswith("-") and eq else raw
            if raw.startswith("-") and not eq:
                out_next = raw in OUT_FLAGS
                continue
            is_out = out_next or (raw.startswith("-") and flag in OUT_FLAGS)
            out_next = False
            if a.startswith(("http://", "https://")):
                continue  # a page for the capture script; the sandbox only reaches the product's site
            if _PROTOCOL.match(a):
                return f"{a} names a protocol; use a file in the video folder (or an http(s) page)"
            if _looks_like_path(a) and not _inside(a, root, (kit / "node_modules",)):
                return f"{a} is outside the video folder"
            script = i == 0 and prog in ("node", "python3")
            if not script and (is_out or not typecheck) and protected(a, root):
                return f"{a} is one of the kit's own files, which can't be changed"
        if prog == "node" and first not in NODE_SCRIPTS:
            return f"node runs the kit's own scripts only ({', '.join(sorted(NODE_SCRIPTS))})"
        if prog == "python3" and first not in PYTHON_SCRIPTS:
            return f"python3 runs the kit's own scripts only ({', '.join(sorted(PYTHON_SCRIPTS))})"
        if prog == "npx" and not (
            first == "tsc" or (first == "remotion" and len(args) > 1 and args[1] in REMOTION_COMMANDS)
        ):
            return f"npx runs tsc --noEmit or remotion {'/'.join(sorted(REMOTION_COMMANDS))} only"
    return None


SOURCE_TYPES: Final = frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".css"})
_SPECIFIERS: Final = re.compile(
    # import … from "x", export … from "x"
    r"""^\s*(?:import|export)\b[^'"`;=<>()]*?\bfrom\s*(['"])(?P<a>[^'"]*)\1"""
    r"""|^\s*import\s*(['"])(?P<b>[^'"]*)\3"""  # import "x"
    r"""|\b(?:import|require)\s*\(\s*(['"`])(?P<c>[^'"`]*)\5"""  # import("x"), require("x")
    r"""|@import\s+(?:url\(\s*)?(['"]?)(?P<d>[^'")\s;]*)\7""",  # CSS @import
    re.MULTILINE,
)
_FOLDER_LOADS: Final = re.compile(r"\brequire\s*\.\s*context\b|\bimport\s*\.\s*meta\s*\.\s*webpackContext\b")


def _link_problem(work: Path, kit: Path | None) -> str | None:
    """A link anywhere in the video folder, other than the server's own node_modules link to the kit's
    packages. The renderer copies public/ into its bundle, so a link could carry a file from home into it."""
    packages = (kit / "node_modules").resolve() if kit is not None else None
    for dirpath, dirnames, filenames in os.walk(work):
        here = Path(dirpath)
        for name in [*dirnames, *filenames]:
            p = here / name
            if not p.is_symlink():
                continue
            if p == work / "node_modules" and packages is not None and p.resolve() == packages:
                continue
            return f"{p.relative_to(work).as_posix()} is a link; the video folder must hold plain files"
        dirnames[:] = [d for d in dirnames if not (here / d).is_symlink()]
    return None


def scene_import_problem(work: Path, kit: Path | None = None) -> str | None:
    """Why the video's sources (``src/**``) can't be bundled, or ``None``. The kit's renderer runs outside the
    agent's sandbox, so before each render the server refuses an import that could pull in a file from
    elsewhere on the computer: an absolute path, a URL-like or home (``~``) name, a ``../`` that climbs out of
    the folder, a file that is a link, or webpack's "load a whole folder" forms. Packages by name are fine."""
    root = work.resolve()
    linked = _link_problem(work, kit)
    if linked is not None:
        return linked
    src = work / "src"
    if not src.exists():
        return None
    if src.is_symlink() or not src.resolve().is_relative_to(root):
        return "src/ must be a folder inside the video folder"
    for f in sorted(src.rglob("*")):
        rel = f.relative_to(work).as_posix()
        if f.is_symlink():
            return f"{rel} is a link; scene files must be plain files in the video folder"
        if not f.is_file() or f.suffix not in SOURCE_TYPES:
            continue
        try:
            text = f.read_text(errors="replace")
        except OSError:
            continue
        if _FOLDER_LOADS.search(text):
            return (
                f"{rel} loads a whole folder (require.context / import.meta.webpackContext); import each file"
            )
        for m in _SPECIFIERS.finditer(text):
            spec = next(g for g in (m.group("a"), m.group("b"), m.group("c"), m.group("d")) if g is not None)
            if not spec:
                continue
            if spec.startswith(("/", "\\", "~")) or ":" in spec or "\\" in spec:
                return f"{rel} imports {spec!r}: import only files in this folder or packages by name"
            if spec.startswith("."):
                target = (f.parent / spec).resolve()
                if not target.is_relative_to(root):
                    return f"{rel} imports {spec!r}, which is outside the video folder"
    return None


def on_site(url: str, domains: list[str]) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return any(host == d or (d.startswith("*.") and host.endswith(d[1:])) for d in domains)


def site_domains(url: str) -> list[str]:
    host = (urlsplit(url).hostname or "").lower()
    if not host:
        raise ValueError(f"not a URL: {url}")
    bare = host.removeprefix("www.")
    return sorted({host, bare, f"*.{bare}"})


Gate = Callable[[str, dict[str, Any], ToolPermissionContext], Awaitable[Any]]


def gate(run_dir: Path, kit: Path, domains: list[str]) -> Gate:
    """The permission check for every tool call the agent makes."""

    async def check(name: str, args: dict[str, Any], _ctx: ToolPermissionContext) -> Any:
        if name in FILE_TOOLS:
            target = str(args.get("file_path") or args.get("path") or run_dir)
            if name not in {"Read", "Glob", "Grep"} and protected(target, run_dir):
                return PermissionResultDeny(
                    message=f"{name} can't change the kit's scripts, packages or skill", interrupt=False
                )
            readable = (kit / "node_modules",) if name in {"Read", "Glob", "Grep"} else ()
            if _inside(target, run_dir, readable):
                return PermissionResultAllow()
            return PermissionResultDeny(message=f"{name} is limited to the video folder", interrupt=False)
        if name == "WebFetch":
            if on_site(str(args.get("url") or ""), domains):
                return PermissionResultAllow()
            return PermissionResultDeny(
                message="WebFetch is limited to the product's own site", interrupt=False
            )
        if name == "Bash":
            why = command_ok(str(args.get("command") or ""), run_dir, kit)
            if why is None:
                return PermissionResultAllow()
            return PermissionResultDeny(message=f"not allowed here: {why}", interrupt=False)
        if name in FREE_TOOLS or name == "WebSearch":  # web search runs at Anthropic, not on this machine
            return PermissionResultAllow()
        return PermissionResultDeny(message=f"{name} is not available here", interrupt=False)

    return check


def sandbox_settings(
    run_dir: Path, domains: list[str], *, deny: Iterable[Path], allow: Iterable[Path] = ()
) -> SandboxSettings:
    """Shell commands run in the OS sandbox: the network only to the product's site, writes only in the
    video folder, and no reading of the home folder (keys, other projects), the other videos or the app's
    own folder (where the key is), except the video folder itself and ``allow`` (the kit's packages, the
    tools' own installs)."""
    settings: dict[str, Any] = {
        "enabled": True,
        "autoAllowBashIfSandboxed": True,
        "allowUnsandboxedCommands": False,
        "network": SandboxNetworkConfig(allowedDomains=domains, allowLocalBinding=True),
        "filesystem": {
            "denyRead": [str(p.resolve()) for p in (Path.home(), *deny)],
            "allowRead": [str(p.resolve()) for p in (run_dir, *allow)],
            "denyWrite": [str(p) for p in protected_paths(run_dir)],
        },
    }
    return cast(SandboxSettings, settings)  # "filesystem" isn't in the SDK's type yet; it passes it through
