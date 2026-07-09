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

    # Ultrawide: the working column caps at 1720px and centers instead of
    # stretching the hero into a banner.
    wide = browser.new_page(viewport={"width": 3440, "height": 1440})
    wide.goto(base)
    wide.wait_for_selector(".hero-card", timeout=10000)
    wide.wait_for_timeout(400)
    cap = wide.evaluate("""() => {
      const view = document.querySelector('.view.active').getBoundingClientRect();
      const shell = document.querySelector('.main-shell').getBoundingClientRect();
      return { width: view.width, leftGap: view.left - shell.left,
               rightGap: shell.right - view.right };
    }""")
    check(f"ultrawide caps content at 1720 ({cap['width']:.0f})", cap["width"] <= 1721)
    check(f"ultrawide centers content (gaps {cap['leftGap']:.0f}/{cap['rightGap']:.0f})",
          abs(cap["leftGap"] - cap["rightGap"]) <= 2)
    check(f"ultrawide no sideways scroll", wide.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0)
    wide.close()

    # Mobile sanity: the stacked layout must never scroll sideways, and the
    # About page shows its stats as a 2x2 grid.
    mobile = browser.new_context(
        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True
    ).new_page()
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

    # Filter strip: when the chips overflow on a phone, the right edge fades
    # (scroll affordance) instead of hard-clipping a chip mid-letter.
    mobile.get_by_role("button", name="Library").first.click()
    mobile.wait_for_selector(".library-row")
    mobile.wait_for_timeout(300)
    fades = mobile.evaluate("""() => {
      const row = document.getElementById('filterRow');
      return { overflows: row.scrollWidth > row.clientWidth,
               fadeRight: row.classList.contains('fade-right') };
    }""")
    check(f"filter strip fades when scrollable ({fades})",
          not fades["overflows"] or fades["fadeRight"])

    # Touch targets: the 28px transport buttons carry an invisible pad, so a
    # tap just outside the visual bounds still lands on the button.
    mobile.get_by_role("button", name="Radio").first.click()
    mobile.wait_for_timeout(300)
    # Probe above the button: sideways the neighbors' pads overlap by design.
    padded = mobile.evaluate("""() => {
      const btn = document.getElementById('nextBtn');
      const r = btn.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top - 4) === btn;
    }""")
    check("transport buttons have expanded touch hit areas", padded)
    browser.close()

finish()
