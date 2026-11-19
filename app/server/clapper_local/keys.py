"""The person's Claude API key: kept only in the app's own ``.env`` (gitignored, readable by the person
only), sent only to Anthropic's API, and shown again only as its last four characters."""

from __future__ import annotations

import contextlib
import os
import re
import tempfile
from pathlib import Path
from typing import Final

ENV_NAME: Final = "ANTHROPIC_API_KEY"
SHAPE: Final = re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,300}")


class KeyRejectedError(Exception):
    """Claude didn't accept the key (or couldn't be reached to check it). The message is plain words and is
    redacted before it is shown."""


class BadKeyError(ValueError):
    """It isn't shaped like a Claude API key."""


def default_env_file() -> Path:
    """``oss/app/.env`` (``app/.env`` in the public repo): next to the server folder."""
    return Path(__file__).resolve().parents[2] / ".env"


class KeyStore:
    def __init__(self, env_file: Path) -> None:
        self.env_file = env_file

    def _lines(self) -> list[str]:
        try:
            return self.env_file.read_text().splitlines()
        except OSError:
            return []

    def load(self) -> str | None:
        """The saved key, or ``None``. Only ever from the file, never from the process environment."""
        for line in self._lines():
            name, _, value = line.partition("=")
            if name.strip() == ENV_NAME:
                value = value.strip().strip('"').strip("'")
                return value or None
        return None

    def state(self) -> dict[str, object]:
        key = self.load()
        return {"set": key is not None, "last4": key[-4:] if key else None}

    def _write(self, lines: list[str]) -> None:
        self.env_file.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".env.", dir=self.env_file.parent)
        try:
            with os.fdopen(fd, "w") as f:
                f.write("".join(f"{line}\n" for line in lines))
            Path(name).chmod(0o600)
            Path(name).replace(self.env_file)
        except BaseException:
            with contextlib.suppress(OSError):
                Path(name).unlink()
            raise

    def save(self, key: str) -> None:
        if not SHAPE.fullmatch(key):
            raise BadKeyError("That doesn't look like a Claude API key (it starts with sk-ant-).")
        keep = [ln for ln in self._lines() if ln.partition("=")[0].strip() != ENV_NAME]
        self._write([*keep, f"{ENV_NAME}={key}"])

    def remove(self) -> None:
        keep = [ln for ln in self._lines() if ln.partition("=")[0].strip() != ENV_NAME]
        if self.env_file.exists():
            self._write(keep)


def check_with_claude(key: str) -> None:
    """One tiny call that costs nothing (list one model), to see that Claude accepts the key."""
    import anthropic

    try:
        anthropic.Anthropic(api_key=key, max_retries=1, timeout=20).models.list(limit=1)
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        raise KeyRejectedError("Claude didn't accept that key. Check it and paste it again.") from e
    except anthropic.APIConnectionError as e:
        raise KeyRejectedError("Couldn't reach Claude to check the key. Check your connection.") from e
    except anthropic.APIStatusError as e:
        raise KeyRejectedError(f"Claude couldn't check the key just now (HTTP {e.status_code}).") from e
