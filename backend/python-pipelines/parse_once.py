"""One-shot parser for the Node worker (in-process Python path).

Usage: python3 parse_once.py <file_path> <original_name>

Prints the parse contract JSON (same shape as the /parse HTTP endpoint) on
stdout and exits 0. Any failure exits nonzero with the reason on stderr —
the Node worker treats a nonzero exit as a signal to fall back to its JS
parsers, so an upload never fails because of Python.
"""

import json
import sys

from parsers import parse_dispatch


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: parse_once.py <file_path> <original_name>", file=sys.stderr)
        return 2
    file_path, name = sys.argv[1], sys.argv[2]
    try:
        with open(file_path, "rb") as f:
            data = f.read()
        result = parse_dispatch(data, name)
    except Exception as exc:  # noqa: BLE001 — the exit code is the error channel
        print(f"parsing failed: {exc}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
