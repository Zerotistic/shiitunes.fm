"""Layout invariants. The load-bearing one: no desktop viewport we support
may show a page scrollbar on any view — the app shell is designed to fit.
(1280x720 is accepted to scroll; don't add it here.)"""
from playwright.sync_api import sync_playwright

from helpers import check, finish, serve

DESKTOP_VIEWPORTS = [(1920, 1080), (1440, 900), (1366, 768)]
VIEWS = ["Radio", "Library", "About"]

with serve() as base, sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in DESKTOP_VIEWPORTS:
        page = browser.new_page(viewport={"width": width, "height": height})
        page.goto(base)
        page.wait_for_selector(".hero-card", timeout=10000)
        page.wait_for_timeout(600)
        for view in VIEWS:
            page.get_by_role("button", name=view).first.click()
            page.wait_for_timeout(400)
            overflow = page.evaluate(
                "document.documentElement.scrollHeight - document.documentElement.clientHeight"
            )
            check(f"{view} fits at {width}x{height} (overflow={overflow})", overflow <= 0)
            sideways = page.evaluate(
                "document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            check(f"{view} no sideways scroll at {width}x{height}", sideways <= 0)
        page.close()

    # Mobile sanity: the stacked layout must never scroll sideways, and the
    # About page shows its stats as a 2x2 grid.
    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto(base)
    mobile.wait_for_selector(".hero-card", timeout=10000)
    for view in VIEWS:
        mobile.get_by_role("button", name=view).first.click()
        mobile.wait_for_timeout(400)
        sideways = mobile.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        check(f"{view} no sideways scroll at 390x844", sideways <= 0)
    columns = mobile.evaluate(
        "getComputedStyle(document.querySelector('.about-stats')).gridTemplateColumns.split(' ').length"
    )
    check(f"About stats are 2-across on mobile ({columns})", columns == 2)
    browser.close()

finish()
