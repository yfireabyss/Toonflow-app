import json, time, urllib.request, urllib.error, sqlite3

API = "http://127.0.0.1:10588"

def call(path, body):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")

db = sqlite3.connect(r"E:\94-Toonflow\data\db2.sqlite")
db.text_factory = lambda b: b.decode("utf-8", errors="replace")
cur = db.cursor()

# 先用项目 01-test 的资产 #1 (失败那个), 直接重跑 - 先把 imageId 清空
cur.execute("UPDATE o_assets SET imageId=NULL WHERE id=1")
cur.execute("DELETE FROM o_image WHERE id=1")
db.commit()

item = {
    "id": 1, "type": "role",
    "name": "游阅",
    "prompt": "青年男子，剑眉星目，身着青色长袍，腰悬玉佩，背负长剑",
}
print("=== 单条重跑 #1 ===")
status, resp = call("/api/assetsGenerate/batchGenerateImageAssets", {
    "projectId": 1786603269502,
    "model": "comfyui:z-image-turbo",
    "resolution": "1K",
    "concurrentCount": 1,
    "items": [item],
})
print(f"HTTP {status}: {json.dumps(resp, ensure_ascii=False)[:200]}")

ids = []
time.sleep(2)
r2 = cur.execute("SELECT imageId FROM o_assets WHERE id=1").fetchone()
if r2 and r2[0]:
    ids.append(r2[0])
print(f"imageId = {ids}")

print("\n=== 轮询 ===")
for i in range(60):
    time.sleep(3)
    s, r = call("/api/assets/pollingImageAssets", {"ids": ids})
    states = [(it["id"], it.get("state"), it.get("filePath")) for it in (r.get("data") or [])]
    db_r = cur.execute("SELECT id, state, errorReason, filePath FROM o_image WHERE id IN ({})".format(",".join(["?"]*len(ids))), ids).fetchall() if ids else []
    print(f"  t={(i+1)*3:3d}s  api={states}")
    print(f"         db={[(x[0], x[1], (x[2] or '')[:80]) for x in db_r]}")
    done = all(x[1] in ("已完成", "生成失败") for x in db_r)
    if done:
        break
