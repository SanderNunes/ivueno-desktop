"""Lists every t("...") text used by the renderer that has no English version yet (or all with --all)."""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).parent.parent / "src" / "renderer"
call = re.compile(r"\bt\(\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)")
used: dict[str, set] = {}
for f in root.rglob("*.jsx"):
    for m in call.finditer(f.read_text(encoding="utf-8")):
        raw = m.group(1)
        text = json.loads(raw) if raw[0] == '"' else raw[1:-1].replace("\\'", "'")
        if re.search(r"[A-Za-zÀ-ÿ]", text) and not re.fullmatch(r"[a-z]+\.[A-Za-z.]+", text):   # skip dictionary keys like nav.home
            used.setdefault(text, set()).add(f.name)

known = set()
en_file = root / "lib" / "i18n-en.js"
if en_file.exists():
    known = set(json.loads(x) for x in re.findall(r"^\s*(\"(?:[^\"\\]|\\.)*\"):", en_file.read_text(encoding="utf-8"), re.M))
todo = sorted(t for t in used if "--all" in sys.argv or t not in known)
for t in todo:
    print(json.dumps(t, ensure_ascii=False), "  <-", ",".join(sorted(used[t])))
print(f"# {len(todo)} texts without English", file=sys.stderr)
