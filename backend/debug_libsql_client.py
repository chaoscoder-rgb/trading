import asyncio
import os
import urllib.parse
from app.config import settings
import libsql_client

async def test_connect():
    url = settings.TURSO_DB_URL
    token = settings.TURSO_AUTH_TOKEN
    
    print(f"Testing URL: {url}")
    
    # Simple replace
    if url.startswith("libsql://"):
        url = url.replace("libsql://", "https://")
        
    print(f"Connecting to {url}...")
    
    try:
        async with libsql_client.create_client(url, auth_token=token) as client:
            result_set = await client.execute("SELECT 1")
            print(f"Result: {result_set.rows}")
            
            # Check tables
            # result = await client.execute("SELECT name FROM sqlite_master WHERE type='table'")
            # print(f"Tables: {result.rows}")
            
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_connect())
