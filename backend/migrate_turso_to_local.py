import asyncio
import sqlite3
import libsql_client
import os
from dotenv import load_dotenv

async def main():
    print("Loading environment variables...")
    load_dotenv()
    
    turso_url = os.getenv("TURSO_DB_URL")
    turso_token = os.getenv("TURSO_AUTH_TOKEN")
    
    if not turso_url or not turso_token:
        print("Missing TURSO credentials in .env")
        return

    # Use HTTPs instead of libsql://
    if turso_url.startswith("libsql://"):
        turso_url = turso_url.replace("libsql://", "https://")

    print(f"Connecting to Turso: {turso_url}")
    remote_client = libsql_client.create_client(turso_url, auth_token=turso_token)
    
    print("Connecting to local SQLite: trading.db")
    local_conn = sqlite3.connect("trading.db")
    local_cursor = local_conn.cursor()
    
    # Create local schema
    schema_queries = [
        "CREATE TABLE IF NOT EXISTS commodities (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT UNIQUE, name TEXT)",
        "CREATE TABLE IF NOT EXISTS prices (id INTEGER PRIMARY KEY AUTOINCREMENT, commodity_symbol TEXT, price REAL, timestamp DATETIME, FOREIGN KEY(commodity_symbol) REFERENCES commodities(symbol))",
        "CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, commodity_symbol TEXT, type TEXT, price REAL, amount REAL, cost_basis REAL, timestamp DATETIME, is_paper BOOLEAN)",
        "CREATE TABLE IF NOT EXISTS holdings (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT UNIQUE, quantity REAL, avg_price REAL, last_updated DATETIME)",
        "CREATE TABLE IF NOT EXISTS recommendation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, action TEXT, price_at_rec REAL, confidence REAL, timestamp DATETIME, status TEXT DEFAULT 'Pending', price_after_7d REAL)"
    ]
    for q in schema_queries:
        local_cursor.execute(q)
    local_conn.commit()
    print("Local schema initialized.")
    
    tables = ["commodities", "prices", "trades", "holdings", "recommendation_history"]
    
    for table in tables:
        print(f"\nMigrating table: {table}...")
        
        # 1. Fetch remote data
        try:
            rs = await remote_client.execute(f"SELECT * FROM {table}")
        except Exception as e:
            print(f"  Error fetching from remote {table}: {e}")
            continue
            
        rows = rs.rows
        print(f"  Found {len(rows)} rows in remote database.")
        if not rows:
            continue
            
        # 2. Extract column names from result set
        columns = rs.columns
        col_names = ", ".join(columns)
        placeholders = ", ".join(["?"] * len(columns))
        
        # 3. Insert into local
        try:
            local_cursor.execute(f"DELETE FROM {table}")
            print(f"  Cleared local table {table}.")
            
            data = [tuple(row) for row in rows]
            local_cursor.executemany(f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})", data)
            local_conn.commit()
            print(f"  Inserted {len(data)} rows into local {table}.")
        except Exception as e:
            print(f"  Error inserting into local {table}: {e}")

    remote_client.close()
    local_conn.close()
    print("\nMigration Complete!")

if __name__ == "__main__":
    asyncio.run(main())
