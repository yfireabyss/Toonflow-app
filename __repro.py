import json
import sys
import time
import urllib.request
import urllib.error
import sqlite3

API = "http://127.0.0.1:10588"

def call(path, body):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")

# 找项目 01-test 的 5 个失败的资产 (id 1..5) — imageId 是 null 的话 batchGenerateImageAssets 会重新建
db = sqlite3.connect(r"E:\94-Toonflow\data\db2.sqlite")
db.text_factory = lambda b: b.decode("utf-8", errors="replace")
cur = db.cursor()
print("=== 失败且 imageId=null 的资产 (前 5) ===")
items = []
for row in cur.execute("SELECT id, name, type, prompt, imageId FROM o_assets WHERE imageId IS NULL AND projectId=1786603269502 AND type IN ('role','scene','tool') AND assetsId IS NULL ORDER BY id LIMIT 5"):
    items.append({"id": row[0], "name": row[1], "type": row[2], "prompt": row[3] or "测试"})
    print(f"  #{row[0]} {row[1]} type={row[2]} prompt={(row[3] or '')[:40]}")
if not items:
    print("  (没找到可用资产)")
    sys.exit(0)

print()
print("=== 调 batchGenerateImageAssets ===")
status, resp = call("/api/assetsGenerate/batchGenerateImageAssets", {
    "projectId": 1786603269502,
    "model": "comfyui:z-image-turbo",
    "resolution": "1K",
    "concurrentCount": 1,
    "items": items,
})
print(f"HTTP {status}: {json.dumps(resp, ensure_ascii=False)[:300]}")

# 轮询 pollingImageAssets 看 state
ids = []
time.sleep(3)
for row in cur.execute("SELECT id, imageId FROM o_assets WHERE id IN ({})".format(",".join(["?"] * len(items))), [i["id"] for i in items]):
    if row[1]:
        ids.append(row[1])
print(f"\nimageIds: {ids}")
if not ids:
    sys.exit(0)

print("\n=== 轮询 (每 5s 一次, 最长 240s) ===")
for i in range(48):
    time.sleep(5)
    s, r = call("/api/assets/pollingImageAssets", {"ids": ids})
    states = {}
    for it in (r.get("data") or []):
        states[it["id"]] = (it.get("state"), it.get("filePath"))
    db_state = {}
    for row in cur.execute("SELECT id, state, errorReason, filePath FROM o_image WHERE id IN ({})".format(",".join(["?"] * len(ids))), ids):
        db_state[row[0]] = (row[1], (row[2] or "")[:80], row[3])
    print(f"  t={(i+1)*5:3d}s  api={states}  db={ {k:(v[0],v[1]) for k,v in db_state.items()} }")
    if all(v[0] in ("已完成", "生成失败") for v in db_state.values()):
        break
