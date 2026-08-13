"""Fix remaining localhost hardcodes in data/web/index.html (dist build).

Targets:
  1. L1998 region: setting page "reset baseUrl" button handler
     - old: r.value.baseUrl="http://localhost:10588"
     - new: r.value.baseUrl=window.location.origin+"/api"
  2. L15777 region: setting page baseUrl input placeholder
     - old: placeholder:"http://localhost:10588"
     - new: placeholder:window.location.origin+"/api"
"""
import os, shutil, sys
from pathlib import Path

p = Path(r'E:\94-Toonflow\data\web\index.html')
bak = Path(r'E:\94-Toonflow\data\web\index.html.bak')
text = p.read_text(encoding='utf-8', errors='replace')

# backup once (already done in fix_baseurl.py, skip if exists)
if not bak.exists():
    shutil.copy2(p, bak)
    print(f'BACKUP -> {bak}')

replacements = [
    # setting reset button
    ('r.value.baseUrl="http://localhost:10588"',
     'r.value.baseUrl=window.location.origin+"/api"',
     'reset-baseurl handler'),
    # setting input placeholder (vue tdesign)
    ('placeholder:"http://localhost:10588"',
     'placeholder:window.location.origin+"/api"',
     'baseurl input placeholder'),
]

# ALSO: be safe - update the default in setting store too if not already
# (already done in fix_baseurl.py: o=ue("http://localhost:10588/api") -> o=ue(window.location.origin+"/api"))

new_text = text
applied = []
for old, new, label in replacements:
    n = new_text.count(old)
    if n == 0:
        print(f'SKIP [{label}]: not found')
        continue
    if n > 1:
        print(f'WARN  [{label}]: {n} matches, will replace all')
    new_text = new_text.replace(old, new)
    applied.append((label, n))

p.write_text(new_text, encoding='utf-8')
print(f'\nAPPLIED: {len(applied)} replacements')
for label, n in applied:
    print(f'  - {label}: {n} occurrence(s)')

# Final verification
final = p.read_text(encoding='utf-8', errors='replace')
print(f'\nFinal localhost:10588 count: {final.count("localhost:10588")}')
print(f'Final http://localhost count: {final.count("http://localhost")}')
print(f'Final window.location.origin count: {final.count("window.location.origin")}')
print(f'File size: {p.stat().st_size} bytes')
