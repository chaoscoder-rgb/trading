import time
import asyncio
import httpx
from app.config import settings

class FredService:
    BASE_URL = settings.FRED_BASE_URL
    API_KEY = settings.FRED_API_KEY

    # Macro series change at most daily — cache for 1 hour.
    # Without this, every dashboard load fetched the SAME 3 series once per
    # commodity (15 calls/load); now it's 3 calls per hour total.
    CACHE_TTL = 3600  # seconds

    def __init__(self):
        self._cache = {}          # series_id -> (value, fetched_at)
        self._locks = {}          # series_id -> asyncio.Lock (coalesces concurrent fetches)

    def _get_cached(self, series_id: str):
        hit = self._cache.get(series_id)
        if hit is not None:
            value, fetched_at = hit
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return value
        return None

    async def get_series_latest(self, series_id: str):
        """
        Fetch the latest value for a FRED series (cached, TTL 1h).
        """
        cached = self._get_cached(series_id)
        if cached is not None:
            return cached

        if not self.API_KEY:
            return self._simulate_macro(series_id)

        # One in-flight request per series: parallel commodity processing would
        # otherwise stampede FRED with identical calls before the cache fills.
        lock = self._locks.setdefault(series_id, asyncio.Lock())
        async with lock:
            # Re-check: another task may have filled the cache while we waited.
            cached = self._get_cached(series_id)
            if cached is not None:
                return cached

            async with httpx.AsyncClient() as client:
                try:
                    response = await client.get(
                        f"{self.BASE_URL}/series/observations",
                        params={
                            "series_id": series_id,
                            "sort_order": "desc",
                            "limit": 1,
                            "file_type": "json",
                            "api_key": self.API_KEY
                        },
                        timeout=3.0
                    )
                    data = response.json()
                    if "observations" in data and len(data["observations"]) > 0:
                        val = data["observations"][0]["value"]
                        value = float(val) if val != "." else None
                        if value is not None:
                            # Only cache real values — failures retry next call.
                            self._cache[series_id] = (value, time.monotonic())
                        return value
                    return None
                except Exception as e:
                    print(f"Error fetching FRED series {series_id}: {e}")
                    return self._simulate_macro(series_id)

    async def get_dollar_index(self):
        # DTWEXBGS is the Trade Weighted U.S. Dollar Index: Broad, Goods and Services
        return await self.get_series_latest("DTWEXBGS")

    async def get_10y_yield(self):
        # DGS10 is 10-Year Treasury Constant Maturity Rate
        return await self.get_series_latest("DGS10")

    async def get_fed_funds_rate(self):
        # FEDFUNDS is Effective Federal Funds Rate
        return await self.get_series_latest("FEDFUNDS")

    def _simulate_macro(self, series_id):
        import random
        # Mock values for common FRED series
        if series_id == "DTWEXBGS":
            return 115.0 + random.uniform(-2, 2)
        if series_id == "DGS10":
            return 4.2 + random.uniform(-0.5, 0.5)
        if series_id == "FEDFUNDS":
            return 5.33
        return 5.0 + random.uniform(-1, 1)

fred_service = FredService()
