"""Tests for rate limiting via AuthAttempt table."""

from utk_curio.backend.app.users.rate_limit import (
    MAX_FAILURES,
    can_attempt,
    record_attempt,
)


class TestRateLimit:
    def test_allows_under_threshold(self, app):
        with app.app_context():
            for _ in range(MAX_FAILURES - 1):
                record_attempt("127.0.0.1", "alice", success=False)
            assert can_attempt("127.0.0.1", "alice") is True

    def test_blocks_at_threshold(self, app):
        with app.app_context():
            for _ in range(MAX_FAILURES):
                record_attempt("127.0.0.1", "alice", success=False)
            assert can_attempt("127.0.0.1", "alice") is False

    def test_success_does_not_count(self, app):
        with app.app_context():
            for _ in range(MAX_FAILURES):
                record_attempt("127.0.0.1", "alice", success=True)
            assert can_attempt("127.0.0.1", "alice") is True
