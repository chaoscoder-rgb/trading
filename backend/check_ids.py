import asyncio
import libsql_client
import os
from dotenv import load_dotenv

load_dotenv()

TURSO_URL = os.getenv("TURSO_DB_URL")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN")

async def check_ids():
    url = TURSO_URL.replace("libsql://", "https://")
    async with libsql_client.create_client(url, auth_token=TURSO_TOKEN) as client:
        rs = await client.execute("SELECT id, symbol FROM commodities")
        for row in rs.rows:
            print(f"ID: {row[0]}, Symbol: {row[1]}")

if __name__ == "__main__":
    asyncio.run(check_ids())
