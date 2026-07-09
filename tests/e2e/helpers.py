"""Shared bits for the e2e suites: a throwaway static server over the web
root and a tiny check/report harness. Each suite is a standalone script that
exits non-zero on failure; run_all.py runs the lot."""
import contextlib
import http.server
import socket
import sys
import threading
from functools import partial
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[2]

failures = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        failures.append(name)


def finish():
    if failures:
        print(f"FAILED ({len(failures)}): " + "; ".join(failures))
        sys.exit(1)
    print("ALL PASS")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextlib.contextmanager
def serve():
    """Serve the web root on a free port; yields the base URL."""
    handler = partial(QuietHandler, directory=str(WEB_ROOT))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
