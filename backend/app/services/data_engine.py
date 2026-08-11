import time
import asyncio
import httpx
from app.config import settings

class DataEngine:
    """
    Market data via Massive (massive.com, formerly Polygon.io).

    Design for the free tier (5 requests/min, end-of-day data):
    - ONE daily-aggregates call per symbol serves price, change, RSI, SMA and
      history (indicators are computed locally from the bars).
    - Bars are cached for 1h with per-symbol request coalescing, so a full
      dashboard load costs at most 5 API calls, then 0 until the cache expires.
    - Any API failure falls back to simulated data (labeled in the UI).
    """

    BASE_URL = settings.MASSIVE_BASE_URL
    API_KEY = settings.MASSIVE_API_KEY

    CACHE_TTL = 3600  # seconds; EOD data updates once a day anyway

    # Commodity symbols -> Massive tickers.
    # Metals trade as spot forex pairs; energy/copper have no spot pair on the
    # free tier, so liquid ETFs are used as tracking proxies (noted in the UI).
    SYMBOL_MAP = {
        "GC": ("C:XAUUSD", None),                 # Gold spot
        "SI": ("C:XAGUSD", None),                 # Silver spot
        "CL": ("USO", "price via USO oil ETF proxy"),     # WTI Crude proxy
        "NG": ("UNG", "price via UNG natural gas ETF proxy"),
        "HG": ("CPER", "price via CPER copper ETF proxy"),
    }

    SIM_PRICES = {
        "GC": 2650.00, "SI": 31.50, "CL": 74.20, "HG": 4.15, "NG": 2.85,
        "AAPL": 248.00, "TSLA": 415.00, "NVDA": 135.00, "AMD": 175.00,
        "MSFT": 450.00, "GOOGL": 190.00, "AMZN": 205.00, "G": 45.80,
        "JNJ": 160.00, "SPY": 590.00, "QQQ": 510.00
    }

    def __init__(self):
        self._bars_cache = {}   # api_ticker -> (bars, fetched_at)
        self._locks = {}        # api_ticker -> asyncio.Lock

    def _map_symbol(self, symbol: str):
        return self.SYMBOL_MAP.get(symbol, (symbol, None))

    # ------------------------------------------------------------------ bars

    def _get_cached_bars(self, ticker: str):
        hit = self._bars_cache.get(ticker)
        if hit is not None:
            bars, fetched_at = hit
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return bars
        return None

    async def _get_daily_bars(self, symbol: str, min_days: int = 120):
        """
        Daily OHLC bars (oldest first) from Massive aggregates, cached 1h.
        Returns [] on failure.
        """
        ticker, _ = self._map_symbol(symbol)

        bars = self._get_cached_bars(ticker)
        if bars is not None:
            return bars

        if not self.API_KEY:
            return []

        lock = self._locks.setdefault(ticker, asyncio.Lock())
        async with lock:
            bars = self._get_cached_bars(ticker)
            if bars is not None:
                return bars

            from datetime import datetime, timedelta
            end = datetime.utcnow().date()
            start = end - timedelta(days=max(min_days, 120) * 2)  # margin for weekends/holidays

            async with httpx.AsyncClient() as client:
                try:
                    resp = await client.get(
                        f"{self.BASE_URL}/v2/aggs/ticker/{ticker}/range/1/day/{start}/{end}",
                        params={
                            "adjusted": "true",
                            "sort": "asc",
                            "limit": 500,
                            "apiKey": self.API_KEY,
                        },
                        timeout=6.0,
                    )
                    data = resp.json()
                    results = data.get("results") or []
                    if resp.status_code != 200 or not results:
                        print(f"Massive aggregates error for {ticker}: "
                              f"HTTP {resp.status_code} {data.get('error') or data.get('message') or 'no results'}")
                        return []

                    from datetime import datetime as dt
                    bars = [
                        {
                            "date": dt.utcfromtimestamp(r["t"] / 1000).strftime("%Y-%m-%d"),
                            "open": float(r["o"]),
                            "close": float(r["c"]),
                            "high": float(r["h"]),
                            "low": float(r["l"]),
                            "volume": float(r.get("v", 0)),
                        }
                        for r in results
                    ]
                    self._bars_cache[ticker] = (bars, time.monotonic())
                    return bars
                except Exception as e:
                    print(f"Error fetching Massive bars for {ticker}: {e}")
                    return []

    # ----------------------------------------------------------------- price

    async def get_price(self, symbol: str):
        """
        Latest price (EOD close on the free tier) + day-over-day change.
        """
        _, proxy_note = self._map_symbol(symbol)
        bars = await self._get_daily_bars(symbol)

        if len(bars) >= 1:
            last = bars[-1]
            prev = bars[-2] if len(bars) >= 2 else None
            change = (last["close"] - prev["close"]) if prev else 0.0
            change_pct = (change / prev["close"] * 100) if prev and prev["close"] else 0.0
            return {
                "symbol": symbol,
                "price": last["close"],
                "change": round(change, 4),
                "change_percent": round(change_pct, 2),
                "source": "Live",
                "message": proxy_note or f"EOD close {last['date']} via Massive",
            }

        return self._simulate_price(symbol, self.SIM_PRICES.get(symbol, 100.0),
                                    reason="Massive API unavailable" if self.API_KEY else "No API key")

    def _simulate_price(self, symbol, base_price, reason="Simulation"):
        import random
        variation = random.uniform(-0.01, 0.01)
        price = base_price * (1 + variation)
        return {"symbol": symbol, "price": price, "source": "Simulated", "message": reason}

    # ------------------------------------------------------------ indicators

    @staticmethod
    def _compute_sma(closes, period=20):
        if len(closes) < period:
            return None
        return sum(closes[-period:]) / period

    @staticmethod
    def _compute_rsi(closes, period=14):
        """Wilder-smoothed RSI."""
        if len(closes) < period + 1:
            return None
        gains, losses = [], []
        for i in range(1, len(closes)):
            delta = closes[i] - closes[i - 1]
            gains.append(max(delta, 0.0))
            losses.append(max(-delta, 0.0))
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        for i in range(period, len(gains)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    async def get_indicators(self, symbol: str):
        """
        RSI(14) and SMA(20), computed locally from cached daily bars —
        zero extra API calls beyond the shared aggregates fetch.
        """
        bars = await self._get_daily_bars(symbol)
        closes = [b["close"] for b in bars]

        rsi = self._compute_rsi(closes, 14)
        sma = self._compute_sma(closes, 20)

        if rsi is None:
            return self._simulate_indicators(symbol)

        return {"rsi": rsi, "sma": sma}

    def _simulate_indicators(self, symbol):
        import random
        rsi = random.uniform(25.0, 75.0)
        sma_signal = random.choice(["Above SMA20", "Below SMA20", None])
        return {"rsi": rsi, "sma_sim_signal": sma_signal}

    # --------------------------------------------------------------- history

    async def get_historical_prices(self, symbol: str, days: int = 30):
        """
        Daily closes for charts/volatility: [{"date": ..., "close": ...}, ...]
        """
        bars = await self._get_daily_bars(symbol, min_days=days)
        if bars:
            return [{"date": b["date"], "close": b["close"]} for b in bars[-days:]]
        return self._simulate_history(symbol, days)

    def _simulate_history(self, symbol, days):
        import random
        from datetime import datetime, timedelta
        current = self.SIM_PRICES.get(symbol, 100.0)
        today = datetime.now()
        history = []
        for i in range(days):
            date = (today - timedelta(days=days - 1 - i)).strftime('%Y-%m-%d')
            change = random.uniform(-0.02, 0.02)
            current = current * (1 + change)
            history.append({"date": date, "close": current})
        return history

    # ---------------------------------------------------------------- search

    async def search_symbols(self, query: str):
        """
        Symbol search via Massive reference tickers.
        """
        if not self.API_KEY:
            return [
                {"symbol": "AAPL", "instrument_name": "Apple Inc", "exchange": "NASDAQ", "country": "United States"},
                {"symbol": "TSLA", "instrument_name": "Tesla Inc", "exchange": "NASDAQ", "country": "United States"},
            ]

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    f"{self.BASE_URL}/v3/reference/tickers",
                    params={
                        "search": query,
                        "active": "true",
                        "limit": 10,
                        "apiKey": self.API_KEY,
                    },
                    timeout=6.0,
                )
                data = resp.json()
                results = data.get("results") or []
                return [
                    {
                        "symbol": r.get("ticker"),
                        "instrument_name": r.get("name"),
                        "exchange": r.get("primary_exchange", ""),
                        "country": r.get("locale", "us").upper(),
                    }
                    for r in results
                ]
            except Exception as e:
                print(f"Error searching Massive symbols: {e}")
                return []

data_engine = DataEngine()
