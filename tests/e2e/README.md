# End-to-end tests

Browser-level regression tests for the invariants that unit tests can't see.
Each suite starts its own throwaway static server over the web root — no
setup, no ports to pick, safe to run while a dev server is up.

## One-time setup

```sh
pip install playwright
playwright install chromium
```

## Run

```sh
python3 tests/e2e/run_all.py     # everything
python3 tests/e2e/test_layout.py # or any single suite
```

Every check prints `PASS`/`FAIL`; a suite exits non-zero on any failure.

## What's covered

- **test_layout.py** — the no-scroll invariant: no view may give the page a
  scrollbar at 1920×1080, 1440×900, or 1366×768 (1280×720 is *accepted* to
  scroll — don't add it), no sideways scroll anywhere including mobile, and
  the About stats grid collapses to 2×2 on phones.
- **test_perf.py** — the Lighthouse contract: zero YouTube requests before
  the first user interaction, the player warms after one, the embed is
  `youtube-nocookie.com`, `tracks.json` is fetched exactly once (head preload
  deduplicates), hero art is eager/high-priority while rows stay lazy, and
  the progress bar animates transforms only (compositor-friendly).
- **test_motion.py** — animation triggers: the track-change entrance replays
  only when the track actually changes, the library settle replays on
  query/filter changes but not on "Show more", the play badge crossfades,
  the mobile strip/sheet entrances fire, and `prefers-reduced-motion`
  clamps every animation.
- **test_pwa.py** — the manifest is linked and sane, the service worker
  activates and precaches the shell, and the app opens fully offline.

## Notes

- Suites run against the local files, not production; run them before a
  deploy, not after.
- `test_perf.py` blocks service workers on purpose so its network assertions
  see the page's own requests; worker behavior lives in `test_pwa.py`.
