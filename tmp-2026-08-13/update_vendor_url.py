"""Update vendorConfig ComfyUI URL: 127.0.0.1:8188 -> 192.168.2.165:8188.
Schema: o_vendorConfig(id, inputValues TEXT JSON, models TEXT JSON, enable INT)
All vendor-specific config (name, type, baseUrl, apiKey, ...) lives inside inputValues JSON.
"""
import sqlite3, json
DB = '/www/toonflow-app/data/db2.sqlite'
NEW = '192.168.2.165:8188'
OLD_HOSTS = ('127.0.0.1:8188', 'localhost:8188')

def patch(o, olds, new):
    changed = False
    if isinstance(o, dict):
        for k, v in list(o.items()):
            if isinstance(v, str):
                nv = v
                for old in olds:
                    if old in nv:
                        nv = nv.replace(old, new)
                if nv != v:
                    o[k] = nv
                    changed = True
            else:
                if patch(v, olds, new):
                    changed = True
    elif isinstance(o, list):
        for i, v in enumerate(o):
            if isinstance(v, str):
                nv = v
                for old in olds:
                    if old in nv:
                        nv = nv.replace(old, new)
                if nv != v:
                    o[i] = nv
                    changed = True
            else:
                if patch(v, olds, new):
                    changed = True
    return changed

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row

print('=== o_vendorConfig SCHEMA ===')
for r in conn.execute('PRAGMA table_info(o_vendorConfig)'):
    print(f"  {r['name']:20s} {r['type']}")

print('\n=== BEFORE (rows with 8188) ===')
for r in conn.execute("SELECT id, enable, inputValues FROM o_vendorConfig WHERE inputValues LIKE '%8188%' OR inputValues LIKE '%localhost%' OR inputValues LIKE '%127.0.0.1%'"):
    print(f"  [{r['id']}] enable={r['enable']}")
    print(f"    inputValues={str(r['inputValues'])[:400]}")

# update inputValues JSON
n_updated = 0
for r in conn.execute("SELECT id, inputValues FROM o_vendorConfig WHERE inputValues LIKE '%8188%' OR inputValues LIKE '%localhost%' OR inputValues LIKE '%127.0.0.1%'"):
    iv = r['inputValues']
    if not iv:
        continue
    try:
        d = json.loads(iv)
    except Exception:
        continue
    if patch(d, OLD_HOSTS, NEW):
        conn.execute(
            "UPDATE o_vendorConfig SET inputValues=? WHERE id=?",
            (json.dumps(d, ensure_ascii=False), r['id']),
        )
        n_updated += 1
        print(f"  -> updated id={r['id']}")

conn.commit()

print('\n=== AFTER ===')
for r in conn.execute("SELECT id, enable, inputValues FROM o_vendorConfig WHERE inputValues LIKE '%8188%' OR inputValues LIKE '%192.168.2.165%'"):
    print(f"  [{r['id']}] enable={r['enable']}")
    print(f"    inputValues={str(r['inputValues'])[:400]}")

print(f"\n=== SUMMARY: {n_updated} vendor row(s) updated ===")
conn.close()
