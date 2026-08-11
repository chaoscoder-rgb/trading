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

    # --- Futures (primary source for commodities) ---------------------------
    # CME product codes with their active delivery months and expiry style.
    # Front-month contract is computed locally (no continuous contracts on
    # Massive); the contracts endpoint is the fallback resolver.
    # Month codes: F G H J K M N Q U V X Z = Jan..Dec
    MONTH_CODES = {1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M",
                   7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z"}
    FUTURES_PRODUCTS = {
        # symbol: (active delivery months, expiry style)
        # energy expires late in the month BEFORE delivery; metals expire
        # near the END of the delivery month.
        "CL": (list(range(1, 13)), "energy"),      # WTI Crude — monthly
        "NG": (list(range(1, 13)), "energy"),      # Natural Gas — monthly
        "GC": ([2, 4, 6, 8, 10, 12], "metal"),     # Gold
        "SI": ([3, 5, 7, 9, 12], "metal"),         # Silver
        "HG": ([3, 5, 7, 9, 12], "metal"),         # Copper
    }
    ROLL_BUFFER_DAYS = 7  # roll to the next contract this many days before approximate expiry

    # Fallback mapping when futures data is unavailable for the key:
    # metals via spot forex pairs, energy/copper via liquid ETF proxies.
    SYMBOL_MAP = {
        "GC": ("C:XAUUSD", "spot XAU/USD (futures unavailable)"),
        "SI": ("C:XAGUSD", "spot XAG/USD (futures unavailable)"),
        "CL": ("USO", "price via USO oil ETF proxy (futures unavailable)"),
        "NG": ("UNG", "price via UNG natural gas ETF proxy (futures unavailable)"),
        "HG": ("CPER", "price via CPER copper ETF proxy (futures unavailable)"),
    }

    SIM_PRICES = {
        "GC": 2650.00, "SI": 31.50, "CL": 74.20, "HG": 4.15, "NG": 2.85,
        "AAPL": 248.00, "TSLA": 415.00, "NVDA": 135.00, "AMD": 175.00,
        "MSFT": 450.00, "GOOGL": 190.00, "AMZN": 205.00, "G": 45.80,
        "JNJ": 160.00, "SPY": 590.00, "QQQ": 510.00
    }

    def __init__(self):
        self._bars_cache = {}       # symbol -> ((bars, note), fetched_at)
        self._locks = {}            # symbol -> asyncio.Lock
        self._contract_cache = {}   # product -> (ticker, fetched_at); 24h TTL

    def _map_symbol(self, symbol: str):
        return self.SYMBOL_MAP.get(symbol, (symbol, None))

    # ------------------------------------------------------------- futures

    def _front_month_ticker(self, symbol: str):
        """
        Compute the front-month contract ticker (e.g. CLV6) from the CME
        calendar, rolling ROLL_BUFFER_DAYS before approximate expiry.
        """
        from datetime import date, timedelta
        months, style = self.FUTURES_PRODUCTS[symbol]
        today = date.today()

        candidates = []
        for year in (today.year, today.year + 1):
            for m in months:
                # Approximate expiry: energy expires ~20th of the month BEFORE
                # delivery (CL: 3 business days before the 25th; NG: end of
                # M-1); metals trade to ~end of the delivery month.
                if style == "energy":
                    py, pm = (year, m - 1) if m > 1 else (year - 1, 12)
                    ref = date(py, pm, 20)
                else:
                    ref = (date(year, m, 28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
                if ref - timedelta(days=self.ROLL_BUFFER_DAYS) > today:
                    candidates.append((ref, year, m))
        if not candidates:
            return None
        _, year, m = min(candidates)
        return f"{symbol}{self.MONTH_CODES[m]}{year % 10}"

    async def _resolve_contract_via_api(self, client, symbol: str):
        """
        Fallback front-month resolver: ask Massive's contracts index for
        active contracts of this product and take the nearest expiry.
        Cached 24h. Returns None if unavailable.
        """
        hit = self._contract_cache.get(symbol)
        if hit and time.monotonic() - hit[1] < 86400:
            return hit[0]
        try:
            resp = await client.get(
                f"{self.BASE_URL}/futures/v1/contracts",
                params={"product_code": symbol, "active": "true",
                        "limit": 50, "apiKey": self.API_KEY},
                timeout=6.0,
            )
            if resp.status_code != 200:
                return None
            from datetime import date, timedelta
            floor = (date.today() + timedelta(days=5)).isoformat()
            contracts = []
            for c in resp.json().get("results") or []:
                last = c.get("last_trade_date") or c.get("expiration_date") or ""
                if c.get("ticker") and str(last)[:10] > floor:
                    contracts.append((str(last)[:10], c["ticker"]))
            if not contracts:
                return None
            ticker = min(contracts)[1]
            self._contract_cache[symbol] = (ticker, time.monotonic())
            return ticker
        except Exception as e:
            print(f"Contracts lookup failed for {symbol}: {e}")
            return None

    async def _fetch_futures_bars(self, client, symbol: str, ticker: str):
        """Daily session bars for a futures contract. Returns [] on failure."""
        from datetime import date, timedelta
        start = (date.today() - timedelta(days=240)).isoformat()
        try:
            resp = await client.get(
                f"{self.BASE_URL}/futures/v1/aggs/{ticker}",
                params={"resolution": "1session", "window_start.gte": start,
                        "limit": 500, "apiKey": self.API_KEY},
                timeout=6.0,
            )
            if resp.status_code != 200:
                return []
            bars = []
            for r in resp.json().get("results") or []:
                close = r.get("close", r.get("settlement_price"))
                if close is None:
                    continue
                bars.append({
                    "date": str(r.get("session_end_date", ""))[:10],
                    "open": float(r.get("open", close)),
                    "close": float(close),
                    "high": float(r.get("high", close)),
                    "low": float(r.get("low", close)),
                    "volume": float(r.get("volume", 0)),
                })
            bars.sort(key=lambda b: b["date"])
            return bars
        except Exception as e:
            print(f"Futures aggs failed for {ticker}: {e}")
            return []

    # ------------------------------------------------------------------ bars

    def _get_cached_bars(self, symbol: str):
        hit = self._bars_cache.get(symbol)
        if hit is not None:
            payload, fetched_at = hit
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return payload
        return None

    async def _fetch_stock_forex_bars(self, client, ticker: str, min_days: int):
        """Daily bars via the standard aggregates endpoint (stocks/forex)."""
        from datetime import datetime, timedelta
        end = datetime.utcnow().date()
        start = end - timedelta(days=max(min_days, 120) * 2)
        try:
            resp = await client.get(
                f"{self.BASE_URL}/v2/aggs/ticker/{ticker}/range/1/day/{start}/{end}",
                params={"adjusted": "true", "sort": "asc", "limit": 500,
                        "apiKey": self.API_KEY},
                timeout=6.0,
            )
            data = resp.json()
            results = data.get("results") or []
            if resp.status_code != 200 or not results:
                print(f"Massive aggregates error for {ticker}: "
                      f"HTTP {resp.status_code} {data.get('error') or data.get('message') or 'no results'}")
                return []
            from datetime import datetime as dt
            return [
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
        except Exception as e:
            print(f"Error fetching Massive bars for {ticker}: {e}")
            return []

    async def _get_daily_bars_with_note(self, symbol: str, min_days: int = 120):
        """
        Daily OHLC bars (oldest first) + source note, cached 1h per symbol.

        Resolution chain for commodities:
          1. Futures front-month (computed calendar ticker, e.g. CLV6)
          2. Futures front-month via the contracts index (if 1 had no data)
          3. Spot forex pair / ETF proxy
        Anything else (stocks etc.) goes straight to the standard aggregates.
        Returns ([], None) on total failure.
        """
        cached = self._get_cached_bars(symbol)
        if cached is not None:
            return cached

        if not self.API_KEY:
            return [], None

        lock = self._locks.setdefault(symbol, asyncio.Lock())
        async with lock:
            cached = self._get_cached_bars(symbol)
            if cached is not None:
                return cached

            async with httpx.AsyncClient() as client:
                bars, note = [], None

                if symbol in self.FUTURES_PRODUCTS:
                    # 1. computed front month
                    ticker = self._front_month_ticker(symbol)
                    if ticker:
                        bars = await self._fetch_futures_bars(client, symbol=symbol, ticker=ticker)
                        note = f"front-month futures {ticker}"
                    # 2. contracts-index fallback
                    if not bars:
                        api_ticker = await self._resolve_contract_via_api(client, symbol)
                        if api_ticker and api_ticker != ticker:
                            bars = await self._fetch_futures_bars(client, symbol=symbol, ticker=api_ticker)
                            note = f"front-month futures {api_ticker}"

                # 3. spot/ETF proxy (or the direct path for non-commodities)
                if not bars:
                    fallback_ticker, fallback_note = self._map_symbol(symbol)
                    bars = await self._fetch_stock_forex_bars(client, fallback_ticker, min_days)
                    note = fallback_note

                if bars:
                    self._bars_cache[symbol] = ((bars, note), time.monotonic())
                return bars, note

    async def _get_daily_bars(self, symbol: str, min_days: int = 120):
        bars, _ = await self._get_daily_bars_with_note(symbol, min_days)
        return bars

    # ----------------------------------------------------------------- price

    async def get_price(self, symbol: str):
        """
        Latest price (EOD close on the free tier) + day-over-day change.
        """
        bars, note = await self._get_daily_bars_with_note(symbol)

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
                "message": f"{note or 'Massive'}, session {last['date']}",
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
