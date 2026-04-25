"""Background tasks for project maintenance.

``cleanup_expired_guest_projects`` hard-deletes guest projects that have been
idle for more than 24 hours. Execution is controlled by the
``GUEST_PROJECT_CLEANUP`` feature flag rather than the current environment.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

from flask import Flask

from utk_curio.backend.config import GUEST_PROJECT_CLEANUP

logger = logging.getLogger(__name__)

GUEST_TTL_HOURS = 24
CLEANUP_INTERVAL_HOURS = 6

_timer: Optional[threading.Timer] = None


def cleanup_expired_guest_projects(app: Flask) -> int:
    """Delete guest-owned projects idle > 24h.  Returns count of deleted."""
    from sqlalchemy.exc import OperationalError
    from utk_curio.backend.extensions import db
    from utk_curio.backend.app.projects.models import Project
    from utk_curio.backend.app.users.models import User
    from utk_curio.backend.app.projects import storage
    from utk_curio.backend.app.projects.services import _user_dir_key

    cutoff = datetime.now(timezone.utc) - timedelta(hours=GUEST_TTL_HOURS)
    deleted = 0

    with app.app_context():
        try:
            rows = (
                db.session.query(Project, User)
                .join(User, Project.user_id == User.id)
                .filter(User.is_guest.is_(True))
                .filter(
                    db.or_(
                        db.and_(
                            Project.last_opened_at.isnot(None),
                            Project.last_opened_at < cutoff,
                        ),
                        db.and_(
                            Project.last_opened_at.is_(None),
                            Project.created_at < cutoff,
                        ),
                    )
                )
                .all()
            )
        except OperationalError:
            logger.debug("Project table not yet created; skipping cleanup")
            return 0

        for project, user in rows:
            try:
                storage.delete_tree(_user_dir_key(user), project.id)
                db.session.delete(project)
                deleted += 1
            except Exception:
                logger.exception("Failed to clean up guest project %s", project.id)

        db.session.commit()

    logger.info("Guest project cleanup: removed %d projects", deleted)
    return deleted


def _schedule_next(app: Flask) -> None:
    global _timer
    interval = CLEANUP_INTERVAL_HOURS * 3600

    def _run():
        try:
            cleanup_expired_guest_projects(app)
        finally:
            _schedule_next(app)

    _timer = threading.Timer(interval, _run)
    _timer.daemon = True
    _timer.start()


def start_cleanup_scheduler(app: Flask) -> None:
    """Run an initial cleanup and schedule periodic repeats when enabled."""
    if not GUEST_PROJECT_CLEANUP:
        return
    try:
        cleanup_expired_guest_projects(app)
    except Exception:
        logger.exception("Initial guest cleanup failed")
    _schedule_next(app)
