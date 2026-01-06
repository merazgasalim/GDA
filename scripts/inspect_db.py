import sqlite3, json, os
DB='prisma/dev.db'
if not os.path.exists(DB):
    print('DB not found:', DB)
    raise SystemExit(2)
conn=sqlite3.connect(DB)
cur=conn.execute("PRAGMA table_info('ProductCompatibility')")
rows=cur.fetchall()
cols=[{"cid":r[0],"name":r[1],"type":r[2],"notnull":r[3],"dflt_value":r[4],"pk":r[5]} for r in rows]
print(json.dumps(cols, indent=2, ensure_ascii=False))
conn.close()
