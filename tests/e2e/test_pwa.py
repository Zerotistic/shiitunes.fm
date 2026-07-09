"""PWA contract: valid manifest wired into the page, service worker installs
and precaches the shell, and the app still opens with the network gone."""
from playwright.sync_api import sync_playwright

from helpers import check, finish, serve

with serve() as base, sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.goto(base)
    page.wait_for_selector(".hero-card", timeout=10000)

    check("manifest is linked",
          page.evaluate("Boolean(document.querySelector('link[rel=\"manifest\"]'))"))
    manifest = page.evaluate(
        "fetch('./manifest.webmanifest').then((r) => r.json())"
    )
    check("manifest has name/start_url/icons",
          manifest.get("name") == "ShiiTunes"
          and manifest.get("start_url")
          and len(manifest.get("icons", [])) >= 2)

    # worker registers, activates, and precaches the shell
    page.wait_for_function("navigator.serviceWorker?.controller || false", timeout=15000)
    cached = page.evaluate("""async () => {
      const keys = await caches.keys();
      const cache = await caches.open(keys[0]);
      const urls = (await cache.keys()).map((request) => request.url);
      return { name: keys[0], count: urls.length,
               hasIndex: urls.some((u) => u.endsWith('/index.html')),
               hasData: urls.some((u) => u.includes('tracks.json')) };
    }""")
    check(f"shell precached ({cached['count']} entries in {cached['name']})",
          cached["count"] >= 30 and cached["hasIndex"] and cached["hasData"])

    # the whole app must open offline
    context.set_offline(True)
    page.reload()
    page.wait_for_selector(".hero-card", timeout=10000)
    check("app shell renders offline",
          page.evaluate("document.querySelectorAll('.library-row, .queue-card').length > 0 || Boolean(document.querySelector('.hero-title'))"))
    title = page.evaluate("document.getElementById('heroTitle').textContent")
    check(f"track data available offline ({title[:40]!r})", bool(title.strip()))
    context.set_offline(False)
    browser.close()

finish()
