import time
import asyncio
import httpx

class CongressService:
    """
    Congressional / executive-branch trading data from the open
    kadoa-org/congress-trading-monitor dataset (STOCK Act disclosures,
    MIT-licensed static JSON on GitHub). No API key, no rate limits.

    Replaces the Finnhub congressional-trading endpoint (premium-gated).
    """

    BASE_URL = "https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/main/public/data/ticker"

    # Disclosures update on filing cadence (days/weeks) — cache for 24h.
    CACHE_TTL = 86400  # seconds

    # Commodity symbols -> the ETFs politicians actually trade
    ETF_MAP = {
        "GC": "GLD",   # Gold
        "SI": "SLV",   # Silver
        "CL": "USO",   # Crude Oil
        "NG": "UNG",   # Natural Gas
        "HG": "CPER",  # Copper
    }

    def __init__(self):
        self._cache = {}   # ticker -> (trades, fetched_at)
        self._locks = {}   # ticker -> asyncio.Lock

    def _map_to_etf(self, symbol: str) -> str:
        return self.ETF_MAP.get(symbol, symbol)

    @staticmethod
    def _normalize(trade: dict) -> dict:
        """Map kadoa fields to the shape the frontend expects."""
        raw_type = (trade.get("transaction_type") or "").strip()
        # "Sale (Full)" / "Sale (Partial)" / "Sale" -> "Sale"; keep "Purchase" as-is
        if raw_type.lower().startswith("sale"):
            tx_type = "Sale"
        elif raw_type.lower().startswith("purchase"):
            tx_type = "Purchase"
        else:
            tx_type = raw_type or "Unknown"

        return {
            "representative": trade.get("filer_name") or "Official",
            "transactionType": tx_type,
            "date": trade.get("transaction_date"),
            "amount": trade.get("amount_range_label"),
            "branch": trade.get("branch"),
            "party": trade.get("party"),
        }

    def _get_cached(self, ticker: str):
        hit = self._cache.get(ticker)
        if hit is not None:
            trades, fetched_at = hit
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return trades
        return None

    async def get_trades(self, symbol: str) -> list:
        """
        Latest disclosed trades for a symbol (via its ETF proxy for
        commodities), newest first. Returns [] when the ticker has no
        disclosures (e.g. UNG/CPER) or on any fetch error.
        """
        ticker = self._map_to_etf(symbol)

        cached = self._get_cached(ticker)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(ticker, asyncio.Lock())
        async with lock:
            cached = self._get_cached(ticker)
            if cached is not None:
                return cached

            async with httpx.AsyncClient() as client:
                try:
                    resp = await client.get(
                        f"{self.BASE_URL}/{ticker}.json",
                        timeout=6.0,
                        follow_redirects=True,
                    )
                    if resp.status_code == 404:
                        # No disclosures for this ticker — a real, cacheable answer
                        self._cache[ticker] = ([], time.monotonic())
                        return []
                    resp.raise_for_status()
                    data = resp.json()

                    trades = [self._normalize(t) for t in data.get("trades", [])]
                    # Newest first by transaction date
                    trades.sort(key=lambda t: t.get("date") or "", reverse=True)

                    self._cache[ticker] = (trades, time.monotonic())
                    return trades
                except Exception as e:
                    print(f"Error fetching congress trades for {ticker}: {e}")
                    return []  # not cached — retry on next call

    @staticmethod
    def political_signal(trades: list) -> str:
        """Bullish/Bearish/Neutral based on the 5 most recent disclosures."""
        recent = trades[:5]
        buys = sum(1 for t in recent if t.get("transactionType") == "Purchase")
        sells = sum(1 for t in recent if t.get("transactionType") == "Sale")
        if buys > sells:
            return "Bullish Political Flow"
        if sells > buys:
            return "Bearish Political Flow"
        return "Neutral"

congress_service = CongressService()
