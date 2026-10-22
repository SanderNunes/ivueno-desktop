"""Wraps the visible Portuguese text of the React screens in t("...") and lists what it found (to translate).

Handles: plain JSX text between tags, and the attributes placeholder / aria-label / title / label / hint / alt written as
plain strings. Everything dynamic (text mixed with {expressions}, strings inside JS code) is left for a human.
Idempotent: text already wrapped is not touched. Usage: python scripts/wrap_i18n.py <file> [<file> ...]
"""
import json
import re
import sys
from pathlib import Path

LETTER = re.compile(r"[A-Za-zÀ-ÿ]")
SKIP = {"ivuenu", "OK", "APAGAR", "Ivuenu", "ABCD-EFGH", "00:12:38", "Word (.docx)", "PDF", "Markdown (.md)", "English", "Português",
        "Ctrl", "Pro", "Pro + Nuvem", "SSO"}
ATTR = re.compile(r'(\s)(placeholder|aria-label|title|label|hint|alt)="([^"{}]*[A-Za-zÀ-ÿ][^"{}]*)"')
TEXT = re.compile(r"(?<![=\-])>([^<>{};]*[A-Za-zÀ-ÿ][^<>{};]*)<")      # not after an arrow (=>), and never across code (;)

found: dict[str, set] = {}


def q(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def wrap_file(path: Path) -> None:
    src = path.read_text(encoding="utf-8")

    def attr(m):
        text = m.group(3)
        if text in SKIP:
            return m.group(0)
        found.setdefault(path.name, set()).add(text)
        return f"{m.group(1)}{m.group(2)}={{t({q(text)})}}"

    def text(m):
        raw = m.group(1)
        core = raw.strip()
        if not core or core in SKIP or not LETTER.search(core) or core.startswith("//") or core[0] in ",:;)?&|":
            return m.group(0)
        found.setdefault(path.name, set()).add(core)
        lead = raw[: len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()):]
        return f">{lead}{{t({q(core)})}}{trail}<"

    out = ATTR.sub(attr, src)
    out = TEXT.sub(text, out)
    if out != src and "useT" not in out:
        # import the hook (path depends on the folder)
        rel = "../lib/i18n.js"
        first_import_end = out.index("\n", out.index("import "))
        out = out[: first_import_end + 1] + f"import {{ useT }} from '{rel}';\n" + out[first_import_end + 1:]
    # give every component that uses t( its own `const t = useT();`
    pieces = re.split(r"(?m)^(?=(?:export default )?function [A-Z]\w*\()", out)
    fixed = []
    for piece in pieces:
        m = re.match(r"(?:export default )?function [A-Z]\w*\([^\n]*\)\s*\{\n", piece)
        if m and re.search(r"\bt\(", piece) and "const t = useT();" not in piece:
            piece = piece[: m.end()] + "  const t = useT();\n" + piece[m.end():]
        fixed.append(piece)
    path.write_text("".join(fixed), encoding="utf-8")


if __name__ == "__main__":
    for name in sys.argv[1:]:
        wrap_file(Path(name))
    print(json.dumps({k: sorted(v) for k, v in found.items()}, ensure_ascii=False, indent=1))
