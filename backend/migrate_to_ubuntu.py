import asyncio
import libsql_client
import os
from dotenv import load_dotenv

# Load current .env (which should point to Ubuntu server)
load_dotenv()

async def main():
    # Source Configuration (Turso Cloud)
    # We'll pull these from TradingEnvFile.txt or environment if present
    # For now, let's look for them specifically
    source_url = "libsql://trading-chaoscoder-rgb.aws-us-east-2.turso.io"
    source_token = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NjkyNzIzNDQsImlkIjoiY2IzYjMwYTQtNzljYi00YzgxLTlmZjAtMzg1YThhZWU4ZTJlIiwicmlkIjoiMTZkMjRhNjItNjgzNS00ZjJhLWFhM2EtOTk3NTdlZDJkNWI0In0.5xqJ-_YGTiDgyeFKdwJaLwlQHRfYogBBNjKxbtTbfNz6YqOROHqTtzJWrkRamrA0ksj_mJNcpysHouLb0XubAg"
    
    # Target Configuration (Ubuntu Server)
    target_url = os.getenv("TURSO_DB_URL")
    target_token = os.getenv("TURSO_AUTH_TOKEN", "")

    if not target_url:
        print("Error: TURSO_DB_URL not found in .env")
        return

    print(f"Connecting to Source (Turso): {source_url}")
    # Force https for Turso
    src_url_http = source_url.replace("libsql://", "https://")
    src_client = libsql_client.create_client(src_url_http, auth_token=source_token)
    
    print(f"Connecting to Target (Ubuntu): {target_url}")
    dst_client = libsql_client.create_client(target_url, auth_token=target_token)
    
    tables = ["commodities", "prices", "trades", "holdings", "recommendation_history"]
    
    try:
        # 1. Initialize Schema on Target
        print("\nInitializing schema on target...")
        schema = [
            "CREATE TABLE IF NOT EXISTS commodities (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT UNIQUE, name TEXT)",
            "CREATE TABLE IF NOT EXISTS prices (id INTEGER PRIMARY KEY AUTOINCREMENT, commodity_symbol TEXT, price REAL, timestamp DATETIME, FOREIGN KEY(commodity_symbol) REFERENCES commodities(symbol))",
            "CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, commodity_symbol TEXT, type TEXT, price REAL, amount REAL, cost_basis REAL, timestamp DATETIME, is_paper BOOLEAN)",
            "CREATE TABLE IF NOT EXISTS holdings (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT UNIQUE, quantity REAL, avg_price REAL, last_updated DATETIME)",
            "CREATE TABLE IF NOT EXISTS recommendation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, action TEXT, price_at_rec REAL, confidence REAL, timestamp DATETIME, status TEXT DEFAULT 'Pending', price_after_7d REAL)"
        ]
        for q in schema:
            await dst_client.execute(q)
        
        # 2. Migrate Data
        for table in tables:
            print(f"\nMigrating table: {table}...")
            
            # Fetch from source
            rs = await src_client.execute(f"SELECT * FROM {table}")
            rows = rs.rows
            print(f"  Fetched {len(rows)} rows from source.")
            
            if not rows:
                continue
                
            columns = rs.columns
            col_names = ", ".join(columns)
            placeholders = ", ".join(["?"] * len(columns))
            
            # Clear target table
            await dst_client.execute(f"DELETE FROM {table}")
            
            # Insert into target
            # Note: libsql_client.execute supports list of values
            for row in rows:
                await dst_client.execute(f"INSERT INTO {table} ({col_names}) VALUES ({placeholders})", list(row))
            
            print(f"  Successfully migrated {len(rows)} rows to target.")

    except Exception as e:
        print(f"Migration Failed: {e}")
    finally:
        src_client.close()
        dst_client.close()
        print("\nMigration Complete!")

if __name__ == "__main__":
    asyncio.run(main())
