"""Authentication middleware using Bearer token scheme."""

from __future__ import annotations

from functools import wraps

from flask import g, jsonify, request

from utk_curio.backend.app.users import repositories as repo


def get_current_token() -> str | None:
    """Extract the Bearer token from the request, if present."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return auth_header or None


def get_current_session():
    """Return the active session for the request token, or None."""
    token = get_current_token()
    if not token:
        return None

    session = repo.session_by_token(token)
    if not session:
        return None

    if session.is_expired:
        return None
    return session


def get_current_user():
    """Extract and validate the Bearer token, returning the User or None."""
    session = get_current_session()
    if not session:
        return None
    repo.touch_session(session)
    user = repo.user_by_id(session.user_id)
    return user


def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authorization required."}), 401
        g.user = user
        return f(*args, **kwargs)

    return decorated_function
