import sqlite3

def migrate():
    try:
        conn = sqlite3.connect("trading.db")
        cursor = conn.cursor()
        
        # Check if column exists
        cursor.execute("PRAGMA table_info(trades)")
        columns = [info[1] for info in cursor.fetchall()]
        
        if "cost_basis" not in columns:
            print("Migrating: Adding cost_basis to trades table...")
            cursor.execute("ALTER TABLE trades ADD COLUMN cost_basis REAL")
            conn.commit()
            print("Migration successful.")
        else:
            print("Migration not needed: cost_basis already exists.")
            
        conn.close()
    except Exception as e:
        print(f"Migration error: {e}")

if __name__ == "__main__":
    migrate()
