import asyncio
import httpx
from app.config import settings

async def test_symbol(symbol):
    url = f"{settings.TWELVEDATA_BASE_URL}/price"
    params = {"symbol": symbol, "apikey": settings.TWELVEDATA_API_KEY}
    
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, params=params)
            print(f"Testing {symbol}: {resp.status_code} - {resp.text}")
        except Exception as e:
            print(f"Error {symbol}: {e}")

async def main():
    print("--- Debugging Symbols ---")
    await test_symbol("GC")
    await test_symbol("XAU/USD")
    await test_symbol("HG")
    await test_symbol("XCU/USD") # Copper ??
    await test_symbol("NG")

if __name__ == "__main__":
    asyncio.run(main())
