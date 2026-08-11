import time
import asyncio
import httpx
from datetime import datetime, timedelta
from app.config import settings

# Commodities -> the ETF/stock whose news & profile stand in for them
PROXY_MAP = {
    "GC": "GLD", "SI": "SLV", "CL": "USO", "NG": "UNG", "HG": "CPER",
}

EARNINGS_KEYWORDS = [
    "earnings", "eps", "revenue", "profit", "guidance", "quarterly", "q1", "q2",
    "q3", "q4", "beat", "miss", "outlook", "forecast", "results", "dividend",
]
LEADERSHIP_KEYWORDS = [
    "ceo", "cfo", "coo", "cto", "chairman", "president", "executive", "board",
    "resign", "appoint", "steps down", "step down", "successor", "hires",
    "names", "layoff", "restructur",
]


class CompanyInfoService:
    """
    Company snapshot for a symbol: profile, key fundamentals and recent news
    bucketed into earnings / leadership / general. Finnhub-backed (free tier),
    cached 1h per symbol. Returns partial data gracefully when endpoints or
    the API key are unavailable.
    """

    CACHE_TTL = 3600

    def __init__(self):
        self.api_key = settings.FINNHUB_API_KEY
        self.base_url = settings.FINNHUB_BASE_URL
        self._cache = {}
        self._locks = {}
        self._metrics_cache = {}   # symbol -> (metrics dict | None, fetched_at)

    async def get_dividend_yield(self, symbol: str):
        """
        Dividend yield %% for a symbol (via ETF proxy for commodities), from a
        lightweight cached metrics call. Returns None when unknown/no key.
        """
        m = await self.get_key_metrics(symbol)
        return m.get("dividend_yield") if m else None

    async def get_key_metrics(self, symbol: str):
        """Cached Finnhub /stock/metric fetch (1 call, 1h TTL)."""
        hit = self._metrics_cache.get(symbol)
        if hit and time.monotonic() - hit[1] < self.CACHE_TTL:
            return hit[0]
        if not self.api_key:
            return None
        lock = self._locks.setdefault(f"metrics:{symbol}", asyncio.Lock())
        async with lock:
            hit = self._metrics_cache.get(symbol)
            if hit and time.monotonic() - hit[1] < self.CACHE_TTL:
                return hit[0]
            lookup = PROXY_MAP.get(symbol, symbol)
            async with httpx.AsyncClient() as client:
                metric = await self._get(client, "/stock/metric", {"symbol": lookup, "metric": "all"})
            m = (metric or {}).get("metric") or {}
            result = None
            if m:
                result = {
                    "pe": m.get("peTTM") or m.get("peBasicExclExtraTTM"),
                    "eps": m.get("epsTTM") or m.get("epsBasicExclExtraItemsTTM"),
                    "week52_high": m.get("52WeekHigh"),
                    "week52_low": m.get("52WeekLow"),
                    "dividend_yield": m.get("dividendYieldIndicatedAnnual") or m.get("currentDividendYieldTTM"),
                    "beta": m.get("beta"),
                }
            # cache even None-ish results briefly to avoid hammering on misses
            self._metrics_cache[symbol] = (result, time.monotonic())
            return result

    def _get_cached(self, symbol):
        hit = self._cache.get(symbol)
        if hit and time.monotonic() - hit[1] < self.CACHE_TTL:
            return hit[0]
        return None

    async def _get(self, client, path, params):
        try:
            resp = await client.get(
                f"{self.base_url}{path}",
                params={**params, "token": self.api_key},
                timeout=5.0,
            )
            if resp.status_code == 200:
                return resp.json()
            print(f"Finnhub {path} -> {resp.status_code}")
        except Exception as e:
            print(f"Finnhub {path} error: {e}")
        return None

    @staticmethod
    def _classify(headline: str, summary: str) -> str:
        hay = f"{headline} {summary}".lower()
        if any(k in hay for k in LEADERSHIP_KEYWORDS):
            return "leadership"
        if any(k in hay for k in EARNINGS_KEYWORDS):
            return "earnings"
        return "general"

    async def get_snapshot(self, symbol: str) -> dict:
        cached = self._get_cached(symbol)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(symbol, asyncio.Lock())
        async with lock:
            cached = self._get_cached(symbol)
            if cached is not None:
                return cached

            lookup = PROXY_MAP.get(symbol, symbol)
            snapshot = {
                "symbol": symbol,
                "lookup_symbol": lookup,
                "is_proxy": lookup != symbol,
                "profile": None,
                "metrics": None,
                "news": {"earnings": [], "leadership": [], "general": []},
                "available": bool(self.api_key),
            }

            if not self.api_key:
                return snapshot  # UI shows a "connect Finnhub" note; not cached

            today = datetime.now().strftime("%Y-%m-%d")
            two_weeks_ago = (datetime.now() - timedelta(days=14)).strftime("%Y-%m-%d")

            async with httpx.AsyncClient() as client:
                profile, metric, news = await asyncio.gather(
                    self._get(client, "/stock/profile2", {"symbol": lookup}),
                    self._get(client, "/stock/metric", {"symbol": lookup, "metric": "all"}),
                    self._get(client, "/company-news",
                              {"symbol": lookup, "from": two_weeks_ago, "to": today}),
                )

            if profile and profile.get("name"):
                snapshot["profile"] = {
                    "name": profile.get("name"),
                    "industry": profile.get("finnhubIndustry"),
                    "exchange": profile.get("exchange"),
                    "market_cap": profile.get("marketCapitalization"),  # in millions
                    "ipo": profile.get("ipo"),
                    "weburl": profile.get("weburl"),
                    "logo": profile.get("logo"),
                }

            m = (metric or {}).get("metric") or {}
            if m:
                snapshot["metrics"] = {
                    "pe": m.get("peTTM") or m.get("peBasicExclExtraTTM"),
                    "eps": m.get("epsTTM") or m.get("epsBasicExclExtraItemsTTM"),
                    "week52_high": m.get("52WeekHigh"),
                    "week52_low": m.get("52WeekLow"),
                    "dividend_yield": m.get("dividendYieldIndicatedAnnual") or m.get("currentDividendYieldTTM"),
                    "beta": m.get("beta"),
                }

            for item in (news or [])[:40]:
                headline = item.get("headline") or ""
                if not headline:
                    continue
                bucket = self._classify(headline, item.get("summary") or "")
                entry = {
                    "headline": headline,
                    "summary": (item.get("summary") or "")[:280],
                    "source": item.get("source"),
                    "url": item.get("url"),
                    "date": datetime.fromtimestamp(item["datetime"]).strftime("%Y-%m-%d")
                            if item.get("datetime") else None,
                }
                if len(snapshot["news"][bucket]) < 5:
                    snapshot["news"][bucket].append(entry)

            self._cache[symbol] = (snapshot, time.monotonic())
            return snapshot


company_info_service = CompanyInfoService()
