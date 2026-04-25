"""Playwright E2E: guest project cleanup (simulated 24h TTL)."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

import pytest

from .utils import allow_guest_login_env, auth_enabled_env, require_project_page

if TYPE_CHECKING:
    from .utils import FrontendPage


def test_guest_can_save_project(app_frontend: FrontendPage, page):
    """Guest workspace should be reachable and able to save a new dataflow."""
    require_project_page()
    base = app_frontend.base_url
    auth_enabled = auth_enabled_env()
    allow_guest = allow_guest_login_env()

    page.goto(f"{base}/auth/signin" if auth_enabled else f"{base}/")
    page.wait_for_load_state("domcontentloaded")

    if auth_enabled:
        if not allow_guest:
            pytest.skip("Explicit guest login is disabled for this session")
        guest_btn = page.get_by_text("Continue as Guest")
        guest_btn.wait_for(timeout=10000)
        guest_btn.click()

    page.wait_for_url("**/projects", timeout=30000)
    page.get_by_role("heading", name="Projects").wait_for(timeout=10000)

    page.get_by_text("+ New Dataflow").click()
    page.wait_for_url("**/dataflow/**", timeout=15000)
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(2000)

    dialogs: list[str] = []
    page.on(
        "dialog",
        lambda dialog: (dialogs.append(dialog.message), dialog.accept()),
    )

    with page.expect_response(
        lambda response: response.request.method == "POST"
        and "/api/projects" in response.url
    ) as save_response:
        page.get_by_role("button", name=re.compile(r"^File")).click()
        page.get_by_role("button", name="Save specification").click()

    response = save_response.value
    assert response.status == 201
    assert response.json()["name"]
    assert dialogs == []
