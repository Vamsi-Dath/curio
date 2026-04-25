"""Phase 2 scaffold: content-addressable execution cache.

Gated behind ``CURIO_PROJECT_EXEC_CACHE`` env flag (default ``false``).
All public functions are no-ops when the flag is off. No wiring into
``/processPythonCode`` yet.
"""
from __future__ import annotations

import hashlib
import json
from typing import Optional

from utk_curio.backend.config import _env_flag


def _flag_enabled() -> bool:
    return _env_flag("CURIO_PROJECT_EXEC_CACHE", False)


def content_key(code: str, input_filenames: list[str], params: dict) -> str:
    """Deterministic hash of code + sorted inputs + serialised params."""
    payload = code + "\0" + "\0".join(sorted(input_filenames)) + "\0" + json.dumps(params, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def lookup(project_id: str, key: str) -> Optional[str]:
    """Return cached ``output_filename`` or ``None``.

    Always returns ``None`` when the feature flag is off.
    """
    if not _flag_enabled():
        return None
    # Phase 2: query ExecCacheEntry table
    return None


def store(project_id: str, activity_name: str, key: str, output_filename: str) -> None:
    """Persist a cache entry. No-op when the flag is off."""
    if not _flag_enabled():
        return
    # Phase 2: insert into ExecCacheEntry
