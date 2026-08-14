"""
r/WallStreetBets sentiment — Tradestie API (public-apis catalog; free, no key).

GET https://api.tradestie.com/v1/apps/reddit
-> top-50 discussed tickers, refreshed every 15 min, 20 req/min per IP.
Response rows: {"ticker", "sentiment": "Bullish"|"Bearish",
                "sentiment_score": -1..1 (small magnitudes), "no_of_comments"}

Commodities are mapped to their liquid ETF proxies (same mapping the news
connector uses), so "GC" looks up GLD chatter, "CL" looks up USO, etc.
A symbol absent from the top-50 list simply contributes nothing.
"""
import time
import asyncio
import httpx
from app.config import settings

# Commodity -> ETF proxy (aligned with AnalyticsEngine.fetch_news)
PROXY = {"GC": "GLD", "SI": "SLV", "CL": "USO", "NG": "UNG", "HG": "CPER"}


class WsbService:
    BASE_URL = settings.TRADESTIE_BASE_URL
    CACHE_TTL = 900  # source refreshes every 15 min

    def __init__(self):
        self._cache = None        # (rows_by_ticker, fetched_at)
        self._lock = asyncio.Lock()

    async def _get_table(self):
        """Full top-50 table as {ticker: row}, cached 15 min."""
        if self._cache is not None:
            rows, fetched_at = self._cache
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return rows

        async with self._lock:
            if self._cache is not None:
                rows, fetched_at = self._cache
                if time.monotonic() - fetched_at < self.CACHE_TTL:
                    return rows
            try:
                async with httpx.AsyncClient(
                    follow_redirects=True,
                    verify=settings.TRADESTIE_VERIFY_SSL,
                ) as client:
                    resp = await client.get(
                        f"{self.BASE_URL}/apps/reddit", timeout=5.0
                    )
                    if resp.status_code != 200:
                        return {}
                    rows = {
                        r["ticker"].upper(): r
                        for r in resp.json()
                        if isinstance(r, dict) and r.get("ticker")
                    }
                    self._cache = (rows, time.monotonic())
                    return rows
            except Exception as e:
                msg = f"Tradestie WSB fetch failed: {e!r}"
                if "CERTIFICATE" in repr(e).upper():
                    msg += " — their TLS cert is expired; set TRADESTIE_VERIFY_SSL=false in .env to bypass this public read-only feed until they renew"
                print(msg)
                return {}

    async def get_sentiment(self, symbol: str):
        """
        Retail sentiment for a symbol (or its ETF proxy).
        Returns {"score": 0-100, "ticker", "comments", "label"} or None
        if the ticker isn't among the top-50 discussed names.
        """
        table = await self._get_table()
        if not table:
            return None

        for ticker in (PROXY.get(symbol, symbol).upper(), symbol.upper()):
            row = table.get(ticker)
            if row:
                raw = float(row.get("sentiment_score") or 0.0)
                # Typical magnitudes are ~0.0-0.3; x150 spreads that to a
                # meaningful 0-100 signal, clamped away from the extremes.
                score = max(5.0, min(95.0, 50.0 + raw * 150.0))
                return {
                    "score": round(score, 1),
                    "ticker": ticker,
                    "comments": int(row.get("no_of_comments") or 0),
                    "label": row.get("sentiment") or ("Bullish" if raw >= 0 else "Bearish"),
                }
        return None


wsb_service = WsbService()
