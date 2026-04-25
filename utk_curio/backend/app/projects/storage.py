"""Filesystem operations for project artifacts.

Every path composed here routes through
:mod:`utk_curio.backend.app.common.safe_paths`, which validates untrusted
segments *and* enforces a proper containment check against the base dir.
Because segment validation rejects ``..`` / path separators before the
filesystem is touched, a traversal attempt like ``project_id="../../etc"``
fails immediately regardless of how deeply the target would have nested
under the users base.
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from utk_curio.backend.app.common.safe_paths import safe_join, validate_component
from utk_curio.backend.app.projects.schemas import OutputRef


def _launch_dir() -> Path:
    return Path(os.environ.get("CURIO_LAUNCH_CWD", os.getcwd()))


def _shared_data_dir() -> Path:
    rel = os.environ.get("CURIO_SHARED_DATA", "./.curio/data/")
    return (_launch_dir() / rel).resolve()


def _users_base() -> Path:
    return (_launch_dir() / ".curio" / "users").resolve()


def _user_id_segment(user_id: int) -> str:
    """Coerce user_id to a digit-only string (ValueError on non-int input)."""
    return str(int(user_id))


# ---------------------------------------------------------------------------
# Directory management
# ---------------------------------------------------------------------------

def project_dir(user_id: int, project_id: str) -> Path:
    return safe_join(
        _users_base(),
        _user_id_segment(user_id),
        "projects",
        project_id,
        field="project_id",
    )


def ensure_project_dir(user_id: int, project_id: str) -> Path:
    d = project_dir(user_id, project_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / "data").mkdir(exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# Spec I/O
# ---------------------------------------------------------------------------

def write_spec(user_id: int, project_id: str, spec: dict) -> Path:
    d = ensure_project_dir(user_id, project_id)
    p = d / "spec.trill.json"
    p.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    return p


def read_spec(user_id: int, project_id: str) -> Optional[dict]:
    d = project_dir(user_id, project_id)
    p = d / "spec.trill.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Output copy / hydration
# ---------------------------------------------------------------------------

def copy_outputs(
    user_id: int,
    project_id: str,
    refs: List[OutputRef],
) -> List[OutputRef]:
    """Copy output .data files from shared cache into the project folder.

    Returns only the refs that were successfully copied (missing source files
    are logged and skipped so partial saves stay self-consistent).
    """
    shared = _shared_data_dir()
    d = ensure_project_dir(user_id, project_id)
    copied: List[OutputRef] = []
    for ref in refs:
        validate_component(ref.filename, field="output filename")
        src = safe_join(shared, ref.filename, validate=False, field="output filename")
        dst = safe_join(d / "data", ref.filename, validate=False, field="output filename")
        if not src.exists():
            continue
        shutil.copy2(str(src), str(dst))
        copied.append(ref)
    return copied


def hydrate_outputs(
    user_id: int,
    project_id: str,
    refs: List[OutputRef],
) -> List[OutputRef]:
    """Copy project data files back into the shared cache so ``/get`` works."""
    shared = _shared_data_dir()
    shared.mkdir(parents=True, exist_ok=True)
    d = project_dir(user_id, project_id)
    hydrated: List[OutputRef] = []
    for ref in refs:
        validate_component(ref.filename, field="output filename")
        src = safe_join(d / "data", ref.filename, validate=False, field="output filename")
        dst = safe_join(shared, ref.filename, validate=False, field="output filename")
        if not src.exists():
            continue
        shutil.copy2(str(src), str(dst))
        hydrated.append(ref)
    return hydrated


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def write_manifest(
    user_id: int,
    project_id: str,
    spec_revision: int,
    refs: List[OutputRef],
) -> Path:
    d = ensure_project_dir(user_id, project_id)
    p = d / "manifest.json"
    entries: List[Dict] = []
    data_dir = d / "data"
    for ref in refs:
        fp = data_dir / ref.filename
        entry: Dict = {"node_id": ref.node_id, "filename": ref.filename}
        if fp.exists():
            stat = fp.stat()
            entry["size"] = stat.st_size
            entry["mtime"] = stat.st_mtime
        entries.append(entry)
    manifest = {
        "project_id": project_id,
        "user_id": user_id,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "spec_revision": spec_revision,
        "outputs": entries,
    }
    p.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return p


def read_manifest(
    user_id: int, project_id: str
) -> Optional[dict]:
    d = project_dir(user_id, project_id)
    p = d / "manifest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Deletion
# ---------------------------------------------------------------------------

def delete_tree(user_id: int, project_id: str) -> None:
    d = project_dir(user_id, project_id)
    if d.exists():
        shutil.rmtree(d)
