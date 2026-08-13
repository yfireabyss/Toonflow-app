import sqlite3
db = sqlite3.connect(r'E:\94-Toonflow\data\db2.sqlite')
db.text_factory = lambda b: b.decode('utf-8', errors='replace')
cur = db.cursor()
print('=== o_image state 分布 ===')
for row in cur.execute('SELECT state, COUNT(*) FROM o_image GROUP BY state'):
    print(f'  {row[0]!r}: {row[1]}')
print()
print('=== 最近 8 条 o_image ===')
for row in cur.execute('SELECT id, filePath, type, assetsId, model, resolution, state, errorReason FROM o_image ORDER BY id DESC LIMIT 8'):
    fp = (row[1] or '')[:60]
    err = (row[7] or '')[:80]
    print(f'  #{row[0]:3d} | state={row[6]!r:14s} | type={row[2]:8s} | model={row[4]!r:20s} | res={row[5]!r:5s} | assetsId={row[3]}')
    if row[1]: print(f'         file: {fp}')
    if err: print(f'         err: {err}')
print()
print('=== 失败 5 条 o_image (state=生成失败) 详情 ===')
for row in cur.execute('SELECT id, filePath, type, assetsId, model, resolution, state, errorReason FROM o_image WHERE state=? ORDER BY id DESC', ('生成失败',)):
    err = (row[7] or '')[:200]
    print(f'  #{row[0]:3d} type={row[2]:8s} model={row[4]!r} res={row[5]!r} assetsId={row[3]}')
    print(f'         err: {err}')
print()
print('=== 现有项目列表 ===')
for row in cur.execute('SELECT id, name, type FROM o_project'):
    print(f'  #{row[0]} {row[1]} (type={row[2]})')
print()
print('=== 现有 assets (01-test 项目, type in role/scene/tool) ===')
for row in cur.execute('SELECT id, name, type, imageId, projectId FROM o_assets WHERE projectId=1 AND type IN (\"role\",\"scene\",\"tool\") AND assetsId IS NULL ORDER BY id'):
    print(f'  #{row[0]:3d} {row[1]:20s} type={row[2]:8s} imageId={row[3]}')
