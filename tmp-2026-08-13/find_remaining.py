"""Find all remaining localhost / baseURL / socket.io / io() hardcodes in dist index.html."""
import re
from pathlib import Path

p = Path(r'E:\94-Toonflow\data\web\index.html')
lines = p.read_text(encoding='utf-8', errors='replace').splitlines()

# search patterns
patterns = {
    'localhost': re.compile(r'localhost'),
    'http://localhost:10588': re.compile(r'http://localhost:10588'),
    'baseURL=': re.compile(r'baseURL\s*='),
    'baseURL:': re.compile(r'baseURL\s*:'),
    'socket.io': re.compile(r'socket\.io'),
    'io(': re.compile(r'\bio\('),
    '10588': re.compile(r'10588'),
}

found = {k: [] for k in patterns}
for i, line in enumerate(lines, 1):
    for name, pat in patterns.items():
        for m in pat.finditer(line):
            ctx_start = max(0, m.start() - 80)
            ctx_end = min(len(line), m.end() + 80)
            ctx = line[ctx_start:ctx_end]
            found[name].append((i, m.group(0), ctx))

for name, items in found.items():
    if not items:
        continue
    print(f'\n=== {name} ({len(items)} hits) ===')
    seen = set()
    for ln, match, ctx in items[:10]:
        sig = (match, ctx[:120])
        if sig in seen:
            continue
        seen.add(sig)
        print(f'  L{ln} [{match}]:')
        print(f'    ...{ctx}...')
