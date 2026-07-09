"""Performance contract: no YouTube bytes before interaction, nocookie embed,
one deduped tracks.json fetch, eager hero art, composited progress bar.
Service workers are blocked here so the network assertions see the page's own
requests — test_pwa.py covers the worker."""
from playwright.sync_api import sync_playwright

from helpers import check, finish, serve

with serve() as base, sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(
        viewport={"width": 1440, "height": 900}, service_workers="block"
    )
    page = context.new_page()
    requests = []
    page.on("request", lambda r: requests.append(r.url))
    page.goto(base)
    page.wait_for_selector(".hero-card .cover-art, .hero-card .fallback-cover", timeout=10000)
    page.wait_for_timeout(1500)

    yt = [u for u in requests if "youtube" in u]
    check(f"no YouTube requests before interaction ({len(yt)})", not yt)
    check("no iframe_api script tag before interaction",
          not page.evaluate("Boolean(document.querySelector('script[src*=\"iframe_api\"]'))"))

    tracks = [u for u in requests if "tracks.json" in u]
    check(f"tracks.json fetched exactly once — preload matches ({len(tracks)})", len(tracks) == 1)

    check("hero cover is eager + fetchpriority=high",
          page.evaluate("""() => {
            const img = document.querySelector('.cover-hero img.cover-art');
            return img && img.loading === 'eager' && img.getAttribute('fetchpriority') === 'high';
          }"""))
    page.get_by_role("button", name="Library").first.click()
    page.wait_for_selector(".library-row img.cover-art")
    check("library covers stay lazy and use the small thumb",
          page.evaluate("""() => {
            const img = document.querySelector('.library-row img.cover-art');
            return img.loading === 'lazy' && (img.src.includes('mqdefault') || img.src.includes('hqdefault'));
          }"""))

    # first interaction (the click above) warms the player
    page.wait_for_timeout(1500)
    check("iframe_api script appears after interaction",
          page.evaluate("Boolean(document.querySelector('script[src*=\"iframe_api\"]'))"))
    src = page.evaluate("document.getElementById('youtubePlayer')?.src || ''")
    check(f"embed uses youtube-nocookie ({src[:60]})", "youtube-nocookie.com/embed" in src)

    # progress bar: transform-driven (compositor), no width/left transitions
    fill = page.evaluate("""() => {
      const fill = document.getElementById('progressFill');
      const style = getComputedStyle(fill);
      return { width: fill.offsetWidth, track: fill.parentElement.offsetWidth,
               transform: style.transform, transition: style.transitionProperty,
               overflow: style.overflow };
    }""")
    check("fill is a full-width clip window", fill["width"] == fill["track"])
    check(f"fill rests at scaleX(0) ({fill['transform']})", fill["transform"] == "matrix(0, 0, 0, 1, 0, 0)")
    check(f"fill transitions transform only ({fill['transition']})", fill["transition"] == "transform")
    check("fill clips its river", fill["overflow"] == "hidden")
    knot = page.evaluate("getComputedStyle(document.querySelector('.knot-wrap')).transitionProperty")
    check(f"knot transitions transform ({knot})", knot == "transform")

    browser.close()

finish()
