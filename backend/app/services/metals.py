"""
Goldprice.dev connector — free cross-validated precious/base metals prices.
(from the public-apis catalog; https://goldprice.dev/docs)

Purpose: a SECOND real price source for GC / SI / HG, so the fallback chain
becomes  futures -> spot/ETF proxy -> Goldprice.dev spot -> simulation
instead of jumping straight from Massive to random simulation.

Anonymous callers get the core row (price/bid/ask); an optional free API key
(GOLDPRICE_API_KEY) lifts rate limits and unlocks extra fields.
"""
import time
import asyncio
import httpx
from app.config import settings


class MetalsService:
    BASE_URL = settings.GOLDPRICE_BASE_URL
    API_KEY = settings.GOLDPRICE_API_KEY

    # App symbol -> goldprice.dev symbol
    SYMBOL_MAP = {
        "GC": "XAU-USD-SPOT",
        "SI": "XAG-USD-SPOT",
        "HG": "HG-USD-FUTURES",
    }

    CACHE_TTL = 300  # spot moves intraday; 5 min is plenty for a fallback source

    def __init__(self):
        self._cache = {}   # app_symbol -> (payload, fetched_at)
        self._locks = {}   # app_symbol -> asyncio.Lock

    def supports(self, symbol: str) -> bool:
        return symbol in self.SYMBOL_MAP

    def _get_cached(self, symbol: str):
        hit = self._cache.get(symbol)
        if hit is not None:
            payload, fetched_at = hit
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return payload
        return None

    async def get_spot(self, symbol: str):
        """
        Latest spot/front-futures price for GC/SI/HG.
        Returns {"price": float, "bid": float|None, "ask": float|None,
                 "computed_at": str} or None on failure.
        """
        if symbol not in self.SYMBOL_MAP:
            return None

        cached = self._get_cached(symbol)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(symbol, asyncio.Lock())
        async with lock:
            cached = self._get_cached(symbol)
            if cached is not None:
                return cached

            headers = {}
            if self.API_KEY:
                headers["Authorization"] = f"Bearer {self.API_KEY}"

            try:
                async with httpx.AsyncClient(follow_redirects=True) as client:
                    resp = await client.get(
                        f"{self.BASE_URL}/v1/prices",
                        params={"symbol": self.SYMBOL_MAP[symbol]},
                        headers=headers,
                        timeout=5.0,
                    )
                    if resp.status_code != 200:
                        print(f"Goldprice.dev HTTP {resp.status_code} for {symbol}: {resp.text[:200]}")
                        return None
                    data = resp.json()
                    # Live response shape: {"symbols": [{...row...}]}; also
                    # tolerate a bare list or a single row object.
                    if isinstance(data, dict):
                        rows = data.get("symbols") or data.get("data") or [data]
                    else:
                        rows = data
                    row = rows[0] if isinstance(rows, list) and rows else {}
                    price = row.get("price")
                    if price is None or row.get("is_stale"):
                        return None
                    payload = {
                        "price": float(price),
                        "bid": float(row["bid"]) if row.get("bid") else None,
                        "ask": float(row["ask"]) if row.get("ask") else None,
                        "computed_at": row.get("computed_at"),
                    }
                    self._cache[symbol] = (payload, time.monotonic())
                    return payload
            except Exception as e:
                print(f"Goldprice.dev fetch failed for {symbol}: {e}")
                return None


metals_service = MetalsService()
