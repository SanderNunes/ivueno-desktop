"""Repair: the first wrapping pass also matched code that follows an arrow (`=> ... <`). Undo exactly those wraps."""
import json
import re
import sys
from pathlib import Path

PATTERN = re.compile(r"=>(\s*)\{t\((\"(?:[^\"\\]|\\.)*\")\)\}")
for name in sys.argv[1:]:
    p = Path(name)
    s = p.read_text(encoding="utf-8")
    n = 0

    def undo(m):
        global n
        n += 1
        return "=>" + m.group(1) + json.loads(m.group(2))

    p.write_text(PATTERN.sub(undo, s), encoding="utf-8")
    print(name, "repaired", n)
