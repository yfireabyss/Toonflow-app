import json, time, urllib.request, urllib.error, sqlite3

API = "http://127.0.0.1:10588"

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

# 登录拿 token
s, r = call("/api/login", {"username": "admin", "password": "admin"})
print(f"login admin/admin -> {s} {json.dumps(r, ensure_ascii=False)[:200]}")
token = ""
if r.get("data", {}).get("token"):
    token = r["data"]["token"]
print(f"token={token[:30]}...")

# 看 o_user 实际用户
db = sqlite3.connect(r"E:\94-Toonflow\data\db2.sqlite")
db.text_factory = lambda b: b.decode("utf-8", errors="replace")
print("\n=== o_user 列表 ===")
for row in db.execute("SELECT id, name FROM o_user"):
    print(f"  #{row[0]} {row[1]}")
