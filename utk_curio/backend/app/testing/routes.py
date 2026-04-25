"""Dev-only HTTP stubs for Playwright E2E tests.

Instead of driving the signup form through the browser, a test fixture POSTs
to ``/api/testing/stub-login`` to create (or fetch) a user + session, then
installs the returned token as a cookie on the Playwright context so the next
navigation is already authenticated. ``/api/testing/stub-project`` seeds a
workflow row owned by that user so ``/projects`` has something to render.

The blueprint is registered by ``create_app`` in every non-production
environment (``CURIO_ENV != 'prod'``, see ``backend/config.py::_is_dev``).
``CURIO_TESTING=1`` is **not** required for the endpoints to work; that
flag only controls whether the backend uses a dedicated test DB or the
default one.
"""

from __future__ import annotations

from flask import Blueprint, abort, jsonify, request

from utk_curio.backend.config import _is_dev
from utk_curio.backend.extensions import db
from utk_curio.backend.app.users import repositories as user_repo
from utk_curio.backend.app.users import security
from utk_curio.backend.app.projects import services as project_services
from utk_curio.backend.app.projects.schemas import ProjectCreate


testing_bp = Blueprint("testing", __name__, url_prefix="/api/testing")


def _guard() -> None:
    """Abort with 404 in production.

    Belt-and-braces: ``create_app`` already gates blueprint registration on
    ``_is_dev()``, but we also refuse at request time in case the env
    changes mid-session (e.g. by a restart that reused the port).
    """
    if not _is_dev():
        abort(404)


def _empty_spec() -> dict:
    """Default workflow spec used when a stub request omits ``spec``.

    Shape matches what ``FlowProvider`` / ``save_project`` expects when a
    brand-new workflow is persisted: an empty dataflow with no nodes or
    edges. Good enough for "/projects lists this project" assertions.
    """
    return {
        "name": "StubbedWorkflow",
        "dataflow": {"nodes": [], "edges": []},
    }


@testing_bp.route("/<path:_ignored>", methods=["OPTIONS"])
@testing_bp.route("/", methods=["OPTIONS"], defaults={"_ignored": ""})
def testing_preflight(_ignored):
    return "", 204


@testing_bp.route("/stub-login", methods=["POST"])
def stub_login():
    """Create-or-find a user + issue a session token.

    Body (JSON):
      * ``username`` – required; looked up first, created if missing.
      * ``name`` – display name, required when creating.
      * ``password`` – optional; when provided the hash is (re)stored so
        the normal ``/api/auth/signin`` form keeps working for the same
        account in follow-up test steps.
      * ``email`` – optional.

    Response: same shape as ``/api/auth/signup`` / ``/api/auth/signin``
    (``{"user": {...}, "token": "..."}``). Callers install ``token`` as the
    ``session_token`` cookie and the SPA is immediately authenticated.
    """
    _guard()
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    name = (body.get("name") or "").strip() or username
    password = body.get("password") or None
    email = body.get("email") or None
    if not username:
        return jsonify({"error": "username is required"}), 400

    user = user_repo.user_by_identifier(username)
    created = False
    if user is None:
        user = user_repo.create_user(
            username=username,
            name=name,
            email=email,
            password_hash=(
                security.hash_password(password) if password else None
            ),
            type="programmer",
        )
        created = True
    elif password:
        user.password_hash = security.hash_password(password)
        db.session.commit()

    session = user_repo.create_session(user.id)
    return (
        jsonify(
            {
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "name": user.name,
                    "email": user.email,
                    "profile_image": user.profile_image,
                    "type": user.type,
                    "is_guest": user.is_guest,
                },
                "token": session.token,
                "created": created,
            }
        ),
        200,
    )


@testing_bp.route("/reset-db", methods=["POST"])
def reset_db():
    """Truncate mutable tables so the next test starts with a clean slate.

    Called by the ``e2e_clean_db`` fixture over HTTP when the test process
    cannot reach the backend's sqlite file directly (e.g.
    ``CURIO_E2E_USE_EXISTING=1`` pointing at a separately-started server
    whose DB path differs from what ``conftest.py`` resolves).

    Body (JSON, all optional):
      * ``tables`` – list of table names to truncate.  Defaults to the
        standard mutable set (user, user_session, project, auth_attempt,
        exec_cache_entry).

    Response: ``{"truncated": [...table names...]}``
    """
    _guard()
    default_tables = [
        "exec_cache_entry",
        "project",
        "auth_attempt",
        "user_session",
        "user",
    ]
    body = request.get_json(silent=True) or {}
    tables = body.get("tables") or default_tables

    truncated = []
    for table in tables:
        try:
            db.session.execute(db.text(f'DELETE FROM "{table}"'))
            truncated.append(table)
        except Exception:
            pass
    db.session.commit()
    return jsonify({"truncated": truncated}), 200


@testing_bp.route("/stub-project", methods=["POST"])
def stub_project():
    """Seed a project owned by an existing stub user.

    Body (JSON):
      * ``username`` – required; must already exist (use ``/stub-login``
        first).
      * ``name`` – project display name, defaults to ``"StubbedWorkflow"``.
      * ``spec`` – optional dataflow spec; defaults to an empty workflow.
      * ``description`` / ``thumbnail_accent`` – optional pass-throughs.

    Response: ``ProjectSummary``-shaped JSON for the newly created row.
    """
    _guard()
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    if not username:
        return jsonify({"error": "username is required"}), 400

    user = user_repo.user_by_identifier(username)
    if user is None:
        return jsonify({"error": f"unknown user {username!r}"}), 404

    name = body.get("name") or "StubbedWorkflow"
    spec = body.get("spec") or _empty_spec()
    data = ProjectCreate(
        name=name,
        spec=spec,
        description=body.get("description"),
        thumbnail_accent=body.get("thumbnail_accent") or "peach",
    )
    detail = project_services.save_project(user, data)
    return (
        jsonify(
            {
                "id": detail.id,
                "name": detail.name,
                "slug": detail.slug,
                "description": detail.description,
                "thumbnail_accent": detail.thumbnail_accent,
            }
        ),
        201,
    )
