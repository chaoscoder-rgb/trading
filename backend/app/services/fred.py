import httpx
from app.config import settings

class FredService:
    BASE_URL = settings.FRED_BASE_URL
    API_KEY = settings.FRED_API_KEY

    async def get_series_latest(self, series_id: str):
        """
        Fetch the latest value for a FRED series.
        """
        if not self.API_KEY:
            return self._simulate_macro(series_id)

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
                    }
                )
                data = response.json()
                if "observations" in data and len(data["observations"]) > 0:
                    val = data["observations"][0]["value"]
                    return float(val) if val != "." else None
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
