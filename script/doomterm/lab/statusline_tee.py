#!/usr/bin/env python3
"""Record the status-line payload and pass it unchanged to the helper under test.

Usage: statusline_tee.py LOG SCRIPT MODE
"""

import json
import subprocess
import sys
import time

log, script, mode = sys.argv[1:4]
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except ValueError:
    data = {}
window = (data.get("context_window") or {}) if isinstance(data, dict) else {}
limits = ((data.get("rate_limits") or {}).get("five_hour") or {}) if isinstance(data, dict) else {}
with open(log, "a", encoding="utf-8") as stream:
    stream.write(json.dumps({
        "wall": time.time(),
        "context_pct": window.get("used_percentage"),
        "usage_pct": limits.get("used_percentage"),
        "usage_resets_at": limits.get("resets_at"),
        "session_id": data.get("session_id") if isinstance(data, dict) else None,
    }) + "\n")
result = subprocess.run([sys.executable, script, mode], input=raw, universal_newlines=True,
                        stdout=subprocess.PIPE)
sys.stdout.write(result.stdout)
sys.exit(result.returncode)
