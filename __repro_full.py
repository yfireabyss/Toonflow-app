import json, time, urllib.request, urllib.error, sqlite3
import jwt as pyjwt

API = "http://127.0.0.1:10588"
SECRET = "a2357928"  # tokenKey from o_setting

def call(path, body, token=""):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token if token.startswith("Bearer ") else f"Bearer {token}"
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode("utf-8"),
        headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")

# 自签 token (180Days)
token = "Bearer " + pyjwt.encode({"id": 1, "name": "fireabyss"}, SECRET, algorithm="HS256")
print(f"self-signed token: {token[:40]}...")

# 测鉴权
s, r = call("/api/setting/about/checkUpdate", {}, token)
print(f"checkUpdate HTTP {s} {json.dumps(r, ensure_ascii=False)[:120]}")

# 重跑 #1
db = sqlite3.connect(r"E:\94-Toonflow\data\db2.sqlite")
db.text_factory = lambda b: b.decode("utf-8", errors="replace")
cur = db.cursor()
cur.execute("UPDATE o_assets SET imageId=NULL WHERE id=1")
cur.execute("DELETE FROM o_image WHERE id=1")
db.commit()

item = {
    "id": 1, "type": "role",
    "name": "游阅",
    "prompt": "青年男子，剑眉星目，身着青色长袍，腰悬玉佩，背负长剑",
}
print("\n=== batchGenerateImageAssets (单条 #1) ===")
s, r = call("/api/assetsGenerate/batchGenerateImageAssets", {
    "projectId": 1786603269502,
    "model": "comfyui:z-image-turbo",
    "resolution": "1K",
    "concurrentCount": 1,
    "items": [item],
}, token)
print(f"HTTP {s}: {json.dumps(r, ensure_ascii=False)[:200]}")

ids = []
time.sleep(2)
r2 = cur.execute("SELECT imageId FROM o_assets WHERE id=1").fetchone()
if r2 and r2[0]:
    ids.append(r2[0])
print(f"imageId = {ids}")

print("\n=== 轮询 (每 5s) ===")
for i in range(40):
    time.sleep(5)
    s, r = call("/api/assets/pollingImageAssets", {"ids": ids}, token)
    states = [(it["id"], it.get("state"), it.get("filePath")) for it in (r.get("data") or [])]
    db_r = cur.execute("SELECT id, state, errorReason, filePath FROM o_image WHERE id IN ({})".format(",".join(["?"]*len(ids))), ids).fetchall() if ids else []
    print(f"  t={(i+1)*5:3d}s  api={states}")
    print(f"         db={[(x[0], x[1], (x[2] or '')[:120]) for x in db_r]}")
    if all(x[1] in ("已完成", "生成失败") for x in db_r):
        break
