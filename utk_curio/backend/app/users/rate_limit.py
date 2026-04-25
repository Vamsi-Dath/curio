"""IP / identifier-based rate limiting backed by the AuthAttempt table."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from utk_curio.backend.extensions import db
from utk_curio.backend.app.users.models import AuthAttempt

WINDOW_SECONDS = 600  # 10 minutes
MAX_FAILURES = 5


def can_attempt(ip: str, identifier: str) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=WINDOW_SECONDS)
    count = (
        AuthAttempt.query.filter(
            AuthAttempt.ip == ip,
            AuthAttempt.identifier == identifier,
            AuthAttempt.success == False,  # noqa: E712
            AuthAttempt.created_at >= cutoff,
        ).count()
    )
    return count < MAX_FAILURES


def record_attempt(ip: str, identifier: str, success: bool) -> None:
    attempt = AuthAttempt(ip=ip, identifier=identifier, success=success)
    db.session.add(attempt)
    db.session.commit()
