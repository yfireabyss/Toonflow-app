import sqlite3
db = sqlite3.connect(r"E:\94-Toonflow\data\db2.sqlite")
db.text_factory = lambda b: b.decode("utf-8", errors="replace")
cur = db.cursor()
print("=== 01-test (1786603269502) 全部非 clip/audio 资产 ===")
for row in cur.execute("SELECT id, name, type, imageId, projectId FROM o_assets WHERE projectId=1786603269502 AND type<>'clip' AND type<>'audio' AND assetsId IS NULL ORDER BY id LIMIT 30"):
    img_state = ""
    if row[3]:
        r2 = cur.execute("SELECT state, errorReason FROM o_image WHERE id=?", (row[3],)).fetchone()
        if r2:
            img_state = f"imageState={r2[0]!r} err={(r2[1] or '')[:60]}"
    print(f"  #{row[0]:3d} {row[1]:24s} type={row[2]:8s} imageId={row[3]} {img_state}")
