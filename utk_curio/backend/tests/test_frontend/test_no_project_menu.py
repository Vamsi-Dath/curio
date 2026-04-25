"""Playwright E2E: File menu hides project-backed entries in --no-project mode.

These tests are the inverse of ``test_project_save_load.py`` — they only
make sense when the backend was started with ``--no-project`` (i.e. the
running server reports ``curio_no_project=true`` on ``/api/config/public``).
``require_no_project_mode()`` skips them in every other configuration so
that the regular ``CURIO_NO_PROJECT=0`` test runs do not see spurious
failures.

Run them with:

    CURIO_NO_PROJECT=1 pytest utk_curio/backend/tests/test_frontend/test_no_project_menu.py
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from playwright.sync_api import Error as PlaywrightError

from .utils import require_no_project_mode

if TYPE_CHECKING:
    from .utils import FrontendPage


# Entries that are gated on ``!skipProjectPage`` in
# ``UpMenu.tsx``. Keep this list in sync with the JSX.
_HIDDEN_ENTRIES = (
    "New dataflow",
    "Saved dataflows",
    "Save specification",
    "Save as...",
)

# Entries that should still render in --no-project mode (sanity check that
# the File menu didn't get hidden in its entirety).
_VISIBLE_ENTRIES = (
    "Import specification",
    "Export specification",
)


def _enter_dataflow(app_frontend: "FrontendPage", page) -> None:
    """Navigate to the SPA root and wait until the dataflow canvas is ready.

    In ``--no-project`` mode the SPA auto-guest-signs in and routes ``/`` to
    ``/dataflow`` (see ``index.tsx``). We dismiss the ``#plug-loader`` splash
    so the File button is clickable, mirroring ``upload_workflow`` in
    ``utils.py``.
    """
    page.goto(f"{app_frontend.base_url}/")
    page.wait_for_url("**/dataflow**", timeout=60000)
    page.wait_for_load_state("domcontentloaded")

    plug = page.locator("#plug-loader")
    try:
        plug.wait_for(state="attached", timeout=10000)
        plug.wait_for(state="detached", timeout=120000)
    except PlaywrightError:
        # Splash never appeared (fast machine / cached assets) — fine.
        pass


def _open_file_menu(page) -> None:
    file_btn = page.get_by_role("button", name=re.compile("File"))
    file_btn.wait_for(state="visible", timeout=60000)
    file_btn.scroll_into_view_if_needed()
    # ``force=True`` so the click isn't swallowed by the ReactFlow canvas
    # (same pattern used by ``upload_workflow``).
    file_btn.click(force=True)


def test_file_menu_hides_project_entries_in_no_project_mode(
    app_frontend: "FrontendPage", page,
):
    """File menu must not surface any project-backed entries.

    In ``--no-project`` mode the SPA has no per-user ``/projects`` page and
    no project-save endpoints to call, so the New / Saved / Save / Save-As
    rows in the File dropdown are gated behind ``!skipProjectPage`` in
    ``UpMenu.tsx``. This test asserts those rows are absent from the DOM
    (we use conditional rendering, not ``display: none``) while
    ``Import specification`` / ``Export specification`` remain reachable.
    """
    require_no_project_mode()
    _enter_dataflow(app_frontend, page)
    _open_file_menu(page)

    for label in _VISIBLE_ENTRIES:
        entry = page.get_by_text(label, exact=True)
        entry.wait_for(state="visible", timeout=10000)
        assert entry.is_visible(), (
            f"Expected File menu entry {label!r} to be visible in "
            f"--no-project mode"
        )

    for label in _HIDDEN_ENTRIES:
        # Conditional rendering => not in the DOM at all. We assert
        # ``count() == 0`` rather than ``is_visible() is False`` so a
        # regression that toggles ``display: none`` instead of unmounting
        # would still fail this test.
        locator = page.get_by_text(label, exact=True)
        assert locator.count() == 0, (
            f"File menu in --no-project mode unexpectedly contains "
            f"{label!r} (count={locator.count()}); UpMenu.tsx should gate "
            f"this row behind !skipProjectPage"
        )


def test_file_menu_has_no_orphan_divider_in_no_project_mode(
    app_frontend: "FrontendPage", page,
):
    """The File menu must not open with a leading divider.

    Regression guard for a layout bug where the divider that originally sat
    *between* ``Saved dataflows`` and ``Import specification`` was rendered
    unconditionally. Once the project-backed block is hidden, that divider
    becomes the first visible child and the dropdown opens with an empty
    line above ``Import specification``.

    We can't rely on class-name substrings (CSS modules hash them in prod
    builds, e.g. ``W8KGkke_NOTP6EUuqRwP``), so we navigate via DOM
    hierarchy instead: ``UpMenu.tsx`` renders the dropdown as the
    ``nextElementSibling`` of the ``File`` ``<button>``, and the first row
    inside it must be the ``Import specification`` entry (dividers in this
    menu are empty ``<div>``s with no text content, so a regression that
    re-orphans the divider would put an empty element first).
    """
    require_no_project_mode()
    _enter_dataflow(app_frontend, page)
    _open_file_menu(page)

    # Wait for the menu to be rendered before we introspect.
    page.get_by_text("Import specification", exact=True).wait_for(
        state="visible", timeout=10000,
    )

    file_btn = page.get_by_role("button", name=re.compile("File"))

    info = page.evaluate(
        """(fileButton) => {
            const menu = fileButton.nextElementSibling;
            if (!menu) {
                return { error: "no element sibling after the File button" };
            }
            const first = menu.firstElementChild;
            if (!first) {
                return { error: "dropdown menu has no children" };
            }
            return {
                firstText: (first.textContent || "").trim(),
                firstHasChildren: first.children.length > 0,
                menuChildCount: menu.children.length,
            };
        }""",
        file_btn.element_handle(),
    )

    assert "error" not in info, (
        f"Could not locate the File dropdown via DOM hierarchy: {info!r}"
    )
    # A divider is an empty ``<div>`` (no children, no text). The first
    # legitimate row in --no-project mode is ``Import specification``.
    assert info["firstText"] == "Import specification", (
        f"File menu in --no-project mode does not open with "
        f"`Import specification` as the first row "
        f"(firstText={info['firstText']!r}, "
        f"firstHasChildren={info['firstHasChildren']}, "
        f"menuChildCount={info['menuChildCount']}). "
        f"This usually means the divider above `Import specification` is "
        f"rendered outside the `!skipProjectPage` block in UpMenu.tsx."
    )
