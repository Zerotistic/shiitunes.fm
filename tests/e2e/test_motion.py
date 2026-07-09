"""Motion pass: track-change entrances replay exactly when the track changes,
library re-renders settle only on context changes, the play badge crossfades,
the mobile strip/sheet animate, and reduced-motion clamps everything."""
from playwright.sync_api import sync_playwright

from helpers import check, finish, serve

with serve() as base, sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(base)
    page.wait_for_selector(".hero-card", timeout=10000)

    # --- track swap: first selection is silent, a change replays it ---
    page.get_by_role("button", name="Library").first.click()
    page.wait_for_selector(".library-row")
    rows = page.query_selector_all(".library-row .library-song-cell")
    rows[0].click()
    page.wait_for_timeout(400)
    first = page.evaluate("document.querySelector('.now-copy').classList.contains('track-swap')")
    rows[1].click()
    page.wait_for_timeout(100)
    check("no swap animation on first selection", not first)
    check("player copy replays .track-swap on track change",
          page.evaluate("document.querySelector('.now-copy').classList.contains('track-swap')"))
    check("swap resolves to the track-swap-in keyframes",
          page.evaluate("getComputedStyle(document.querySelector('.now-copy')).animationName") == "track-swap-in")

    # hero replays too once its surface shows a different track
    page.get_by_role("button", name="Radio").first.click()
    page.wait_for_timeout(200)
    page.get_by_role("button", name="Library").first.click()
    page.wait_for_selector(".library-row")
    page.query_selector_all(".library-row .library-song-cell")[2].click()
    page.get_by_role("button", name="Radio").first.click()
    page.wait_for_timeout(100)
    check("hero title replays .track-swap after track change",
          page.evaluate("document.getElementById('heroTitle').classList.contains('track-swap')"))

    # --- library settle on query change, but not on Show more ---
    page.get_by_role("button", name="Library").first.click()
    page.evaluate("document.querySelector('.library-rows').classList.remove('list-swap')")
    search = page.query_selector(".search-field input")
    search.fill("love")
    page.wait_for_timeout(150)
    check("library replays .list-swap after a search",
          page.evaluate("document.querySelector('.library-rows').classList.contains('list-swap')"))
    search.fill("")
    page.wait_for_timeout(150)
    page.evaluate("document.querySelector('.library-rows').classList.remove('list-swap')")
    more = page.query_selector(".show-more-row")
    if more:
        more.click()
        page.wait_for_timeout(150)
        check("Show more does NOT replay .list-swap",
              not page.evaluate("document.querySelector('.library-rows').classList.contains('list-swap')"))

    # --- play badge crossfade (force known states; playback may be live) ---
    page.evaluate("document.querySelector('.app-shell').classList.remove('is-playing')")
    page.wait_for_timeout(300)
    check("pause glyph hidden via opacity while not playing",
          page.evaluate("getComputedStyle(document.querySelector('.play-badge .pause-icon')).opacity") == "0")
    page.evaluate("document.querySelector('.app-shell').classList.add('is-playing')")
    page.wait_for_timeout(300)
    check("pause glyph fades in when playing",
          page.evaluate("getComputedStyle(document.querySelector('.play-badge .pause-icon')).opacity") == "1")
    check("play glyph fades out when playing",
          page.evaluate("getComputedStyle(document.querySelector('.play-badge .play-icon')).opacity") == "0")

    # --- mobile strip/sheet entrances ---
    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto(base)
    mobile.wait_for_selector(".hero-card", timeout=10000)
    mobile.evaluate("""() => {
      const panel = document.getElementById('nowPanel');
      panel.hidden = false;
      panel.classList.add('has-video');
    }""")
    strip = mobile.evaluate("getComputedStyle(document.getElementById('nowPanel')).animationName")
    mobile.evaluate("document.getElementById('nowPanel').classList.add('is-sheet')")
    sheet = mobile.evaluate("getComputedStyle(document.getElementById('nowPanel')).animationName")
    check(f"docked strip animates in ({strip})", strip == "strip-in")
    check(f"sheet expansion animates ({sheet})", sheet == "sheet-in")

    # --- reduced motion clamps every animation ---
    reduced = browser.new_context(reduced_motion="reduce").new_page()
    reduced.goto(base)
    reduced.wait_for_selector(".brand-star")
    duration = reduced.evaluate("getComputedStyle(document.querySelector('.brand-star')).animationDuration")
    check(f"reduced-motion clamps ambient animation ({duration})", duration in ("0.01ms", "1e-05s"))
    browser.close()

finish()
