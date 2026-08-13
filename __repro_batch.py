import json, time, urllib.request, urllib.error, sqlite3
import jwt as pyjwt

API = "http://127.0.0.1:10588"
SECRET = "a2357928"

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

token = "Bearer " + pyjwt.encode({"id": 1, "name": "fireabyss"}, SECRET, algorithm="HS256")

# 1) 先确认 ComfyUI 现在空闲
import urllib.request as ur
t0 = time.time()
ur.urlopen("http://127.0.0.1:8188/history?max_items=5", timeout=30).read()
print(f"ComfyUI /history (空闲): {(time.time()-t0)*1000:.0f} ms")

# 2) 一次性批量跑 5 条新 prompt, 高并发触发 10s timeout
db = sqlite3.connect(r"E:\94-Toonflow\data\db2.sqlite")
db.text_factory = lambda b: b.decode("utf-8", errors="replace")
cur = db.cursor()
prompts = [
    "黑发男子, 剑眉星目, 青色长袍, 腰悬玉佩, 背负长剑, 古风仙侠",
    "红衣女侠, 长发飞扬, 手持银色软剑, 樱花飘落",
    "白发老者, 灰色道袍, 持拂尘, 山巅松树下",
    "蓝衣书生, 手持折扇, 临江而立, 月下",
    "紫袍道人, 闭目打坐, 蒲团之上, 烟雾缭绕",
]
items = []
for i, p in enumerate(prompts, start=2):
    cur.execute("UPDATE o_assets SET imageId=NULL WHERE id=?", (i,))
    cur.execute("DELETE FROM o_image WHERE assetsId=?", (i,))
    items.append({"id": i, "type": "role", "name": f"测试角色{i}", "prompt": p})
db.commit()
print(f"\n=== 批量跑 5 条 ===")
s, r = call("/api/assetsGenerate/batchGenerateImageAssets", {
    "projectId": 1786603269502,
    "model": "comfyui:z-image-turbo",
    "resolution": "1K",
    "concurrentCount": 5,  # 高并发
    "items": items,
}, token)
print(f"HTTP {s}: {json.dumps(r, ensure_ascii=False)[:200]}")

# 收集 imageId
time.sleep(3)
ids = []
for row in cur.execute("SELECT id, imageId FROM o_assets WHERE id IN ({})".format(",".join(["?"]*5)), [2,3,4,5,6]):
    if row[1]: ids.append(row[1])
print(f"imageIds = {ids}")

print("\n=== 轮询 ===")
fails = 0
oks = 0
for i in range(40):
    time.sleep(5)
    s, r = call("/api/assets/pollingImageAssets", {"ids": ids}, token)
    api_states = [(it["id"], it.get("state")) for it in (r.get("data") or [])]
    db_r = cur.execute("SELECT id, state, errorReason FROM o_image WHERE id IN ({})".format(",".join(["?"]*len(ids))), ids).fetchall()
    states = [(x[0], x[1], (x[2] or "")[:60]) for x in db_r]
    finished = [s for s in states if s[1] in ("已完成", "生成失败")]
    print(f"  t={(i+1)*5:3d}s  finish={len(finished)}/{len(states)}  ok={sum(1 for s in finished if s[1]=='已完成')}  fail={sum(1 for s in finished if s[1]=='生成失败')}")
    if finished:
        for s in finished:
            print(f"        {s}")
    if len(finished) == len(states):
        break

print(f"\n=== 结果 ===")
db_r = cur.execute("SELECT id, state, errorReason FROM o_image WHERE id IN ({})".format(",".join(["?"]*len(ids))), ids).fetchall()
ok = sum(1 for x in db_r if x[1] == "已完成")
fail = sum(1 for x in db_r if x[1] == "生成失败")
print(f"  成功 {ok}, 失败 {fail}")
for x in db_r:
    print(f"  #{x[0]} {x[1]}: {(x[2] or '')[:100]}")
