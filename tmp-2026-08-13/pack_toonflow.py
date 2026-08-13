"""Pack E:\\94-Toonflow into toonflow-app.tar.gz excluding node_modules / .git / logs / tmp-*."""
import os, sys, tarfile, time
from pathlib import Path

SRC = Path(r'E:\94-Toonflow')
DST = Path(r'E:\01-ComfyUI-Serv\tmp-2026-08-13\toonflow-app.tar.gz')
DST.parent.mkdir(parents=True, exist_ok=True)

EXCLUDE_DIRS = {'node_modules', '.git', 'logs', 'tmp-2026-08-13'}
EXCLUDE_FILES = {'yarn-install.log'}

def should_skip(rel_parts, name):
    for p in rel_parts:
        if p in EXCLUDE_DIRS:
            return True
    if name in EXCLUDE_FILES:
        return True
    return False

t0 = time.time()
total = 0
with tarfile.open(DST, 'w:gz', compresslevel=6) as tf:
    for p in sorted(SRC.rglob('*')):
        if not p.is_file():
            continue
        rel = p.relative_to(SRC)
        parts = rel.parts
        if should_skip(parts, p.name):
            continue
        # also skip if any parent dir in EXCLUDE_DIRS
        tf.add(p, arcname=str(Path('toonflow-app') / rel), recursive=False)
        total += p.stat().st_size

elapsed = time.time() - t0
print(f'SRC: {SRC}')
print(f'DST: {DST}')
print(f'Size: {DST.stat().st_size / 1024 / 1024:.1f} MB (compressed)')
print(f'Source total: {total / 1024 / 1024:.1f} MB (uncompressed, after exclusion)')
print(f'Elapsed: {elapsed:.1f}s')

# verify a few files
with tarfile.open(DST, 'r:gz') as tf:
    names = tf.getnames()
    print(f'Entries: {len(names)}')
    for n in names[:5] + names[-5:]:
        print(' ', n)
