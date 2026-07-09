"""Run every e2e suite in order; exit non-zero if any fails.

Usage: python3 tests/e2e/run_all.py   (from the web root, or anywhere)
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUITES = ["test_layout.py", "test_perf.py", "test_motion.py", "test_pwa.py"]

failed = []
for suite in SUITES:
    print(f"\n=== {suite} ===")
    result = subprocess.run([sys.executable, "-u", str(HERE / suite)], cwd=HERE)
    if result.returncode != 0:
        failed.append(suite)

print()
if failed:
    print("FAILED SUITES: " + ", ".join(failed))
    sys.exit(1)
print("ALL SUITES PASS")
