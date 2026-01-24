from fastapi import FastAPI, Depends
import uvicorn
import asyncio
import os
import libsql_client
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

TURSO_URL = os.getenv("TURSO_DB_URL")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN")

async def get_db():
    url = TURSO_URL
    if url.startswith("libsql://"):
        url = url.replace("libsql://", "https://")
    async with libsql_client.create_client(url, auth_token=TURSO_TOKEN) as client:
        yield client

@app.get("/test-order")
async def test_order(db = Depends(get_db)):
    rs = await db.execute("SELECT symbol, id FROM commodities ORDER BY id DESC")
    # Simulation of processing
    results = []
    for row in rs.rows:
        results.append({"symbol": row[0], "id": row[1]})
    return results

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
