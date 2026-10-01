#!/usr/bin/env python3
"""Convert a remote status-line payload log into the plate analyzer's ground truth format."""

import json
import sys
from pathlib import Path


def main():
    source, target = map(Path, sys.argv[1:3])
    with source.open(encoding="utf-8") as payloads, target.open("w", encoding="utf-8") as truth:
        for index, line in enumerate(payloads):
            payload = json.loads(line)
            record = {
                "wall": payload["wall"],
                "pid": 1,
                "agent": "claude",
                "context_pct": payload["context_pct"],
                "usage_pct": payload["usage_pct"],
            }
            if index == 0:
                record["event"] = "start"
            truth.write(json.dumps(record) + "\n")


if __name__ == "__main__":
    main()
