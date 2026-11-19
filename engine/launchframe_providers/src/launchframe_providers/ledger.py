"""Spend ledgers with atomic check-and-reserve, so no set of parallel calls (threads, worker processes)
can together pass a cap. One module, two on-disk shapes:

**Per-call budget guards** (the model and voice caps, :mod:`launchframe_providers.budget` and its voice
twin). Before a paid call the guard **reserves** the call's
worst-case price: under an exclusive lock it sums the ledger plus every outstanding reservation,
refuses if the new price would pass the cap, and records the reservation. The lock is released before
the network call. Afterwards :meth:`JsonlLedger.settle` drops the reservation and, if the call went
through, appends the actual cost row, again under the lock.

* :class:`JsonlLedger`: rows in an append-only JSONL file; reservations in ``<ledger>.reserved.json``;
  the lock is ``fcntl.flock`` on ``<ledger>.lock`` (one lock per open file, so it also serialises
  threads of one process), plus a thread lock. A process that dies mid-call leaves its reservation
  behind, which keeps the guard conservative; delete the ``.reserved.json`` file once nothing runs.
  The ledger itself keeps one row per call (reservations are not rows).
* :class:`MemoryLedger`: the same in memory, for tests.

**Batch runs** (the M3 eval's batches, :mod:`launchframe_providers.batch`): :class:`ReservingLedger`
keeps everything in the JSONL file itself, one row per event:

* ``{"kind": "reserve", "id", "usd", "note"}`` — money set aside before a request (or a whole batch) is
  sent: its worst case. Counted against the cap until it is released.
* ``{"kind": "release", "id"}`` — the reservation is over (the answers are in, or the send failed).
* ``{"kind": "cost", ...CostEntry}`` — what a request actually cost.

``committed = Σ cost + Σ open reservations``. :meth:`ReservingLedger.reserve` reads the ledger, checks
``committed + usd ≤ cap`` and appends the reservation while holding the same exclusive ``flock`` on
``<ledger>.lock``, so parallel processes or threads can never reserve past the cap together. A run that
dies between reserve and release leaves the reservation open, which only makes the cap stricter.

Every ledger file is append-only: nothing here rewrites or deletes rows.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import math
import threading
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel

if TYPE_CHECKING:
    from launchframe_providers.cost import CostEntry


@contextlib.contextmanager
def flocked(path: Path, thread_lock: threading.Lock | threading.RLock) -> Iterator[None]:
    """Exclusive across threads (``thread_lock``) and processes (``flock`` on ``<path>.lock``)."""
    with thread_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.with_name(path.name + ".lock").open("a") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


class CapExceededError(RuntimeError):
    """The reservation would pass the cap. ``spent_usd`` (alias ``committed_usd``) includes
    outstanding reservations; ``amount_usd`` (alias ``requested_usd``) is what was asked for."""

    def __init__(self, spent_usd: float, amount_usd: float, cap_usd: float) -> None:
        super().__init__(
            f"spend cap: committed ${spent_usd:.4f} + reserve ${amount_usd:.4f} > cap ${cap_usd:.2f}"
        )
        self.spent_usd = spent_usd
        self.amount_usd = amount_usd
        self.cap_usd = cap_usd

    @property
    def committed_usd(self) -> float:
        return self.spent_usd

    @property
    def requested_usd(self) -> float:
        return self.amount_usd


class MemoryLedger[E: BaseModel]:
    def __init__(self) -> None:
        self.entries: list[E] = []
        self.reserved: dict[str, float] = {}
        self._lock = threading.RLock()

    def record(self, e: E) -> None:
        with self._lock:
            self.entries.append(e)

    def total(self) -> float:
        with self._lock:
            return sum(float(getattr(e, "costUsd", 0.0)) for e in self.entries)

    def reserve(self, usd: float, cap_usd: float) -> str:
        with self._lock:
            spent = self.total() + sum(self.reserved.values())
            if spent + usd > cap_usd:
                raise CapExceededError(spent, usd, cap_usd)
            token = uuid.uuid4().hex
            self.reserved[token] = usd
            return token

    def settle(self, token: str, entry: E | None) -> None:
        with self._lock:
            self.reserved.pop(token, None)
            if entry is not None:
                self.entries.append(entry)


class JsonlLedger[E: BaseModel]:
    """Append-only JSONL ledger; totals are re-read from disk, so they cover earlier runs and other
    processes too."""

    entry_model: type[E]

    def __init__(self, path: str | Path, entry_model: type[E]) -> None:
        self.path = Path(path)
        self.entry_model = entry_model
        self._thread_lock = threading.RLock()

    @property
    def reserved_path(self) -> Path:
        return self.path.with_name(self.path.name + ".reserved.json")

    @property
    def lock_path(self) -> Path:
        return self.path.with_name(self.path.name + ".lock")

    @contextlib.contextmanager
    def locked(self) -> Iterator[None]:
        """Exclusive across threads and processes (``flock`` on the lock file)."""
        with flocked(self.path, self._thread_lock):
            yield

    def _append(self, e: E) -> None:
        with self.path.open("a", encoding="utf8") as f:
            f.write(e.model_dump_json(exclude_none=True) + "\n")

    def _reservations(self) -> dict[str, float]:
        if not self.reserved_path.exists():
            return {}
        raw = json.loads(self.reserved_path.read_text("utf8") or "{}")
        return {str(k): float(v) for k, v in raw.items()}

    def _save_reservations(self, r: dict[str, float]) -> None:
        tmp = self.reserved_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(r), "utf8")
        tmp.replace(self.reserved_path)

    def record(self, e: E) -> None:
        with self.locked():
            self._append(e)

    def entries(self) -> list[E]:
        if not self.path.exists():
            return []
        lines = self.path.read_text("utf8").splitlines()
        return [self.entry_model.model_validate(json.loads(line)) for line in lines if line.strip()]

    def total(self) -> float:
        return sum(float(getattr(e, "costUsd", 0.0)) for e in self.entries())

    def reserved_total(self) -> float:
        return sum(self._reservations().values())

    def reserve(self, usd: float, cap_usd: float) -> str:
        with self.locked():
            r = self._reservations()
            spent = self.total() + sum(r.values())
            if spent + usd > cap_usd:
                raise CapExceededError(spent, usd, cap_usd)
            token = uuid.uuid4().hex
            r[token] = usd
            self._save_reservations(r)
            return token

    def settle(self, token: str, entry: E | None) -> None:
        with self.locked():
            r = self._reservations()
            r.pop(token, None)
            self._save_reservations(r)
            if entry is not None:
                self._append(entry)


class ReservingLedger:
    def __init__(self, path: str | Path, cap_usd: float) -> None:
        if not math.isfinite(cap_usd) or cap_usd < 0:
            raise ValueError(f"cap must be a finite, non-negative number (got {cap_usd})")
        self.path = Path(path)
        self.cap_usd = cap_usd
        self._thread_lock = threading.Lock()

    # ------------------------------------------------------------- locking and rows

    @contextlib.contextmanager
    def _locked(self) -> Iterator[None]:
        with flocked(self.path, self._thread_lock):
            yield

    def _rows(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        lines = self.path.read_text("utf8").splitlines()
        return [json.loads(line) for line in lines if line.strip()]

    def _append(self, *rows: dict[str, Any]) -> None:
        with self.path.open("a", encoding="utf8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
            f.flush()

    @staticmethod
    def _sums(rows: list[dict[str, Any]]) -> tuple[float, float]:
        spent = sum(float(r["costUsd"]) for r in rows if r.get("kind") == "cost")
        released = {r["id"] for r in rows if r.get("kind") == "release"}
        held = sum(float(r["usd"]) for r in rows if r.get("kind") == "reserve" and r["id"] not in released)
        return spent, held

    # ------------------------------------------------------------- API

    def spent(self) -> float:
        """USD actually spent (cost rows)."""
        with self._locked():
            return self._sums(self._rows())[0]

    def committed(self) -> float:
        """Spent plus open reservations: what the cap is checked against."""
        with self._locked():
            spent, held = self._sums(self._rows())
            return spent + held

    def reserve(self, usd: float, note: str = "") -> str:
        """Atomically check ``committed + usd ≤ cap`` and hold ``usd``; returns the reservation id."""
        if not math.isfinite(usd) or usd < 0:
            raise ValueError(f"reservation must be a finite, non-negative number (got {usd})")
        with self._locked():
            spent, held = self._sums(self._rows())
            if spent + held + usd > self.cap_usd:
                raise CapExceededError(spent + held, usd, self.cap_usd)
            rid = uuid.uuid4().hex
            self._append(
                {
                    "kind": "reserve",
                    "id": rid,
                    "usd": round(usd, 6),
                    "note": note,
                    "at": datetime.now(UTC).isoformat(),
                }
            )
            return rid

    def mark(self, kind: str, **fields: Any) -> None:
        """Append a bookkeeping row (e.g. a run starting or finishing); it carries no money."""
        if kind in ("reserve", "release", "cost"):
            raise ValueError(f"{kind!r} rows are written by reserve and settle")
        with self._locked():
            self._append({"kind": kind, "at": datetime.now(UTC).isoformat(), **fields})

    def marks(self, kind: str) -> list[dict[str, Any]]:
        with self._locked():
            return [r for r in self._rows() if r.get("kind") == kind]

    def settle(self, reservation_id: str, costs: list[CostEntry]) -> None:
        """Record what the requests cost and release the reservation (one locked append)."""
        with self._locked():
            rows = [{"kind": "cost", **c.model_dump(mode="json", exclude_none=True)} for c in costs]
            self._append(
                *rows, {"kind": "release", "id": reservation_id, "at": datetime.now(UTC).isoformat()}
            )
