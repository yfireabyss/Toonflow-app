import sqlite3
db = sqlite3.connect(r'E:\94-Toonflow\data\db2.sqlite')
db.text_factory = lambda b: b.decode('utf-8', errors='replace')
for row in db.execute("SELECT key, substr(value,1,40) FROM o_setting WHERE key='tokenKey'"):
    print(row)
