import sqlite3
import os

db_path = 'trading.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    res = conn.execute("SELECT sql FROM sqlite_master WHERE name='commodities'").fetchone()
    if res:
        print(res[0])
    else:
        print("Table not found")
else:
    print("Database file not found")
