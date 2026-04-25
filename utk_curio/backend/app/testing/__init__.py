"""Test-only Flask blueprint.

This package is intentionally empty at import time and only registered by
``create_app`` when ``CURIO_TESTING=1``. It exposes a set of dev-only HTTP
shortcuts that let Playwright seed users / projects directly into the DB and
install an authenticated session cookie without going through the real signup
form.
"""
