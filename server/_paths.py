# Make the Phase 1/2 training modules importable from the server package,
# whether it runs as `python server/server.py`, `uvicorn server:app`, or tests.
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for _rel in ("training/phase1", "training/phase2", "server"):
    _p = str(ROOT / _rel)
    if _p not in sys.path:
        sys.path.insert(0, _p)
