import json, time, urllib.request, urllib.error, sqlite3

API = "http://127.0.0.1:10588"

def call(path, body, token):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")

# 拿一个 token
s, r = call("/api/login/test", {})
print(f"login HTTP {s}: {json.dumps(r, ensure_ascii=False)[:300]}")
token = r.get("data") or r.get("token") or ""
if not token:
    # 试别的
    for p in ["/api/login", "/api/setting/about/checkUpdate"]:
        s, r = call(p, {}, "")
        print(f"  {p} -> {s} {json.dumps(r, ensure_ascii=False)[:200]}")
    raise SystemExit("no token")
