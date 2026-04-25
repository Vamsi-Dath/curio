"""Business logic for project save / load / list / delete."""
from __future__ import annotations

from typing import List, Optional
from uuid import uuid4

from utk_curio.backend.extensions import db
from utk_curio.backend.app.projects import repositories as repo
from utk_curio.backend.app.projects import storage
from utk_curio.backend.app.projects.schemas import (
    OutputRef,
    ProjectCreate,
    ProjectDetail,
    ProjectSummary,
    ProjectUpdate,
    _slugify,
)
from utk_curio.backend.config import (
    ALLOW_GUEST_LOGIN,
    CURIO_ENV,
    CURIO_SHARED_GUEST_USERNAME,
)


GUEST_PROJECT_LIMIT = 20


class ProjectError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _is_shared_guest(user) -> bool:
    return bool(user and user.is_guest and user.username == CURIO_SHARED_GUEST_USERNAME)


def _user_dir_key(user) -> str:
    return storage._GUEST_KEY if _is_shared_guest(user) else str(user.id)


def _check_guest_quota(user) -> None:
    if not user.is_guest:
        return
    if _is_shared_guest(user):
        return
    if CURIO_ENV == "prod" and not ALLOW_GUEST_LOGIN:
        raise ProjectError("Guest users cannot save projects in production", 403)
    count = repo.list_for_user(user.id, scope="mine")
    if len(count) >= GUEST_PROJECT_LIMIT:
        raise ProjectError(
            f"Guest project limit ({GUEST_PROJECT_LIMIT}) reached", 403
        )


def _to_summary(p) -> ProjectSummary:
    return ProjectSummary(
        id=p.id,
        name=p.name,
        slug=p.slug,
        description=p.description,
        thumbnail_accent=p.thumbnail_accent or "peach",
        spec_revision=p.spec_revision,
        last_opened_at=p.last_opened_at.isoformat() if p.last_opened_at else None,
        created_at=p.created_at.isoformat() if p.created_at else "",
        updated_at=p.updated_at.isoformat() if p.updated_at else "",
        archived_at=p.archived_at.isoformat() if p.archived_at else None,
    )


def _to_detail(p, spec=None, outputs=None) -> ProjectDetail:
    return ProjectDetail(
        id=p.id,
        name=p.name,
        slug=p.slug,
        description=p.description,
        thumbnail_accent=p.thumbnail_accent or "peach",
        spec_revision=p.spec_revision,
        last_opened_at=p.last_opened_at.isoformat() if p.last_opened_at else None,
        created_at=p.created_at.isoformat() if p.created_at else "",
        updated_at=p.updated_at.isoformat() if p.updated_at else "",
        archived_at=p.archived_at.isoformat() if p.archived_at else None,
        folder_path=p.folder_path,
        spec=spec,
        outputs=outputs or [],
    )


def _output_refs_from_manifest(manifest: Optional[dict]) -> List[OutputRef]:
    if not manifest:
        return []
    return [
        OutputRef(node_id=o["node_id"], filename=o["filename"])
        for o in manifest.get("outputs", [])
    ]


# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------

def save_project(user, data: ProjectCreate) -> ProjectDetail:
    _check_guest_quota(user)

    project_id = str(uuid4())
    ukey = _user_dir_key(user)
    folder = str(storage.project_dir(ukey, project_id))

    project = repo.upsert_project(
        user_id=user.id,
        name=data.name,
        folder_path=folder,
        description=data.description,
        thumbnail_accent=data.thumbnail_accent,
    )
    project_id = project.id

    storage.write_spec(ukey, project_id, data.spec)
    copied = storage.copy_outputs(ukey, project_id, data.outputs)
    storage.write_manifest(ukey, project_id, project.spec_revision, copied)

    db.session.commit()
    return _to_detail(project, spec=data.spec, outputs=copied)


def update_project(user, project_id: str, data: ProjectUpdate) -> ProjectDetail:
    project = repo.get_for_user(project_id, user.id)
    ukey = _user_dir_key(user)
    existing_spec = storage.read_spec(ukey, project_id)
    existing_manifest = storage.read_manifest(ukey, project_id)

    folder = str(storage.project_dir(ukey, project_id))
    project = repo.upsert_project(
        user_id=user.id,
        name=data.name or project.name,
        folder_path=folder,
        description=data.description if data.description is not None else project.description,
        thumbnail_accent=data.thumbnail_accent or project.thumbnail_accent,
        project_id=project_id,
    )

    effective_spec = data.spec if data.spec is not None else existing_spec
    if data.spec is not None:
        storage.write_spec(ukey, project_id, data.spec)

    if data.outputs is not None:
        output_refs = storage.copy_outputs(ukey, project_id, data.outputs)
    else:
        output_refs = _output_refs_from_manifest(existing_manifest)

    storage.write_manifest(ukey, project_id, project.spec_revision, output_refs)

    db.session.commit()
    return _to_detail(project, spec=effective_spec, outputs=output_refs)


# ---------------------------------------------------------------------------
# Load (hydration)
# ---------------------------------------------------------------------------

def load_project(user, project_id: str) -> dict:
    project = repo.get_for_user(project_id, user.id)
    repo.touch_last_opened(project_id, user.id)

    ukey = _user_dir_key(user)
    spec = storage.read_spec(ukey, project_id)
    manifest = storage.read_manifest(ukey, project_id)

    output_refs: List[OutputRef] = []
    if manifest and "outputs" in manifest:
        output_refs = [
            OutputRef(node_id=o["node_id"], filename=o["filename"])
            for o in manifest["outputs"]
        ]

    hydrated = storage.hydrate_outputs(ukey, project_id, output_refs)

    db.session.commit()
    return {
        "project": _to_detail(project, spec=spec, outputs=hydrated),
        "spec": spec,
        "outputs": [{"node_id": r.node_id, "filename": r.filename} for r in hydrated],
    }


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def list_projects(
    user, scope: str = "mine", sort: str = "last_opened"
) -> List[ProjectSummary]:
    projects = repo.list_for_user(user.id, scope=scope, sort=sort)
    return [_to_summary(p) for p in projects]


# ---------------------------------------------------------------------------
# Rename
# ---------------------------------------------------------------------------

def rename_project(user, project_id: str, new_name: str) -> ProjectSummary:
    project = repo.get_for_user(project_id, user.id)
    project.name = new_name
    project.slug = repo._unique_slug(user.id, _slugify(new_name), exclude_id=project_id)
    db.session.commit()
    return _to_summary(project)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def delete_project(user, project_id: str, purge: bool = False) -> None:
    if purge:
        project = repo.get_for_user(project_id, user.id)
        storage.delete_tree(_user_dir_key(user), project_id)
        repo.purge_project(project_id, user.id)
    else:
        repo.soft_delete(project_id, user.id)
    db.session.commit()


# ---------------------------------------------------------------------------
# Duplicate
# ---------------------------------------------------------------------------

def duplicate_project(user, project_id: str) -> ProjectDetail:
    src = repo.get_for_user(project_id, user.id)
    ukey = _user_dir_key(user)
    spec = storage.read_spec(ukey, project_id)
    manifest = storage.read_manifest(ukey, project_id)

    output_refs: List[OutputRef] = []
    if manifest and "outputs" in manifest:
        output_refs = [
            OutputRef(node_id=o["node_id"], filename=o["filename"])
            for o in manifest["outputs"]
        ]

    new_name = f"{src.name} (copy)"
    create_data = ProjectCreate(
        name=new_name,
        spec=spec or {},
        outputs=output_refs,
        description=src.description,
        thumbnail_accent=src.thumbnail_accent or "peach",
    )
    return save_project(user, create_data)
