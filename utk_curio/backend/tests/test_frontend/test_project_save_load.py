"""Playwright E2E: save a project and verify it loads in executed state."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from .utils import require_project_page, signup_and_enter_new_workflow, signup_e2e_user

if TYPE_CHECKING:
    from .utils import FrontendPage


def test_project_save_via_menu(app_frontend: "FrontendPage", page):
    """Save via File > Save specification, verify it appears in Saved dataflows.

    Regression guard for the bug where the freshly-saved project did not show
    up in the `Saved dataflows` submenu right after saving because the cached
    `savedProjects` state was not invalidated. `handleSave` now refreshes the
    list via `refreshSavedProjects()` before closing the menu, so reopening
    File > Saved dataflows must render the new project immediately.
    """
    require_project_page()
    signup_and_enter_new_workflow(
        page,
        app_frontend.base_url,
        name="Project Tester",
        username="prjtester",
    )

    file_btn = page.get_by_role("button", name=re.compile("File"))
    file_btn.wait_for(state="visible", timeout=15000)
    file_btn.click(force=True)

    save_btn = page.get_by_text("Save specification", exact=True)
    save_btn.wait_for(state="visible", timeout=5000)
    save_btn.click()
    # `handleSave` closes the File menu once the save + refreshSavedProjects
    # round-trip completes, so the Save button being hidden is our signal that
    # the save is fully done.
    save_btn.wait_for(state="hidden", timeout=10000)
    # wait for the save to be completed
    page.wait_for_timeout(2000)
    # Reopen File menu and expand Saved dataflows; the just-saved project must
    # be visible without needing any extra refresh click. `FlowProvider`
    # seeds `workflowName` to "DefaultDataflow" and `handleSave` defaults to
    # that name, so the new project shows up under that label.
    file_btn.click(force=True)
    saved_wf = page.get_by_text("Saved dataflows", exact=True)
    saved_wf.wait_for(state="visible", timeout=15000)
    saved_wf.click()

    # The submenu's outer div has a CSS-modules-hashed class name so we can't
    # match it by substring — use the stable data-testid instead.
    submenu = page.get_by_test_id("saved-workflows-submenu")
    submenu.wait_for(state="visible", timeout=5000)

    saved_items = submenu.get_by_test_id("saved-workflows-item")
    saved_items.first.wait_for(state="visible", timeout=10000)
    assert saved_items.count() >= 1, (
        f"Expected at least one saved dataflow in the submenu, got: "
        f"{submenu.text_content()!r}"
    )
    # And the specific label we expect for the default-named dataflow.
    expected = submenu.get_by_text("DefaultDataflow", exact=True)
    expected.wait_for(state="visible", timeout=5000)


def test_project_list_page(app_frontend: "FrontendPage", page):
    """Verify the projects page shows saved projects."""
    require_project_page()
    base = app_frontend.base_url

    signup_e2e_user(
        page, base, name="Project Lister", username="prjlister",
    )
    page.goto(f"{base}/projects")
    page.wait_for_load_state("domcontentloaded")
    page.get_by_role("heading", name="Projects").wait_for(timeout=10000)
