import asyncio
import libsql_client
import os
from dotenv import load_dotenv

load_dotenv()

TURSO_URL = os.getenv("TURSO_DB_URL")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN")

async def test():
    url = TURSO_URL
    if url.startswith("libsql://"):
        url = url.replace("libsql://", "https://")
    
    async with libsql_client.create_client(url, auth_token=TURSO_TOKEN) as client:
        rs = await client.execute("SELECT symbol, id FROM commodities ORDER BY id DESC")
        print("Database Order (DESC):")
        for row in rs.rows:
            print(f"- {row[0]} (ID: {row[1]})")

asyncio.run(test())
