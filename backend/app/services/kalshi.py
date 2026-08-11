import time
import asyncio
import base64
import httpx
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from app.config import settings

# Search terms per symbol for filtering market titles (lowercase substrings)
SEARCH_TERMS = {
    "GC": ["gold"],
    "SI": ["silver"],
    "CL": ["oil", "crude", "wti", "opec"],
    "NG": ["natural gas", "nat gas", "henry hub"],
    "HG": ["copper"],
    "AAPL": ["apple"], "TSLA": ["tesla"], "NVDA": ["nvidia"], "MSFT": ["microsoft"],
    "GOOGL": ["google", "alphabet"], "AMZN": ["amazon"], "AMD": ["amd"],
    "SPY": ["s&p"], "QQQ": ["nasdaq"],
}


class KalshiService:
    """
    Kalshi prediction markets via the public market-data API
    (external-api.kalshi.com). Reading market data needs NO authentication —
    the RSA credentials are kept only for possible future authed features.
    Responses cached 30 min per symbol.
    """

    CACHE_TTL = 1800

    def __init__(self):
        self.api_key = settings.KALSHI_API_KEY
        self.base_url = settings.KALSHI_BASE_URL
        self.private_key = self._load_private_key(settings.KALSHI_RSA_PRIVATE_KEY)
        self._cache = {}   # symbol -> (results, fetched_at)
        self._locks = {}

    def _load_private_key(self, key_str):
        if not key_str:
            return None
        try:
            key_str = key_str.strip()
            if "-----BEGIN" not in key_str:
                # env-friendly form: base64 of the PEM file
                key_str = base64.b64decode(key_str).decode()
            # .env files often carry literal "\n" sequences
            key_str = key_str.replace("\\n", "\n")
            return serialization.load_pem_private_key(
                key_str.encode(),
                password=None
            )
        except Exception as e:
            print(f"Error loading Kalshi private key: {e}")
            return None

    def _sign_request(self, method, path, timestamp):
        """Kept for future authenticated endpoints (orders, portfolio)."""
        if not self.private_key:
            return ""
        msg = f"{timestamp}{method}{path}".encode('utf-8')
        signature = self.private_key.sign(msg, padding.PKCS1v15(), hashes.SHA256())
        return base64.b64encode(signature).decode('utf-8')

    def _get_cached(self, symbol):
        hit = self._cache.get(symbol)
        if hit and time.monotonic() - hit[1] < self.CACHE_TTL:
            return hit[0]
        return None

    async def get_bulk_markets(self):
        """
        All open markets (up to 3 pages), simplified to {title, yes}.
        Shared by the batch screener so scoring 500 symbols costs 3 requests,
        not 1500. Cached 30 min.
        """
        cached = self._get_cached("__bulk__")
        if cached is not None:
            return cached
        lock = self._locks.setdefault("__bulk__", asyncio.Lock())
        async with lock:
            cached = self._get_cached("__bulk__")
            if cached is not None:
                return cached
            out = []
            async with httpx.AsyncClient() as client:
                try:
                    cursor = None
                    for _ in range(3):
                        params = {"limit": 200, "status": "open"}
                        if cursor:
                            params["cursor"] = cursor
                        resp = await client.get(f"{self.base_url}/markets", params=params, timeout=6.0)
                        if resp.status_code != 200:
                            break
                        data = resp.json()
                        for m in data.get("markets", []):
                            yes = m.get("last_price") or m.get("yes_ask") or 0
                            if 0 < yes < 100 and m.get("title"):
                                out.append({"title": f"{m['title']} {m.get('subtitle') or ''}".lower(), "yes": int(yes)})
                        cursor = data.get("cursor")
                        if not cursor:
                            break
                except Exception as e:
                    print(f"Kalshi bulk fetch error: {e}")
            self._cache["__bulk__"] = (out, time.monotonic())
            return out

    async def get_market_data(self, ticker: str):
        """
        Open Kalshi markets whose title matches the symbol's search terms.
        Falls back to labeled sample data if nothing matches / API fails.
        """
        cached = self._get_cached(ticker)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(ticker, asyncio.Lock())
        async with lock:
            cached = self._get_cached(ticker)
            if cached is not None:
                return cached

            terms = SEARCH_TERMS.get(ticker, [ticker.lower()])
            results = []
            async with httpx.AsyncClient() as client:
                try:
                    # Public endpoint: no auth headers needed for market data.
                    cursor = None
                    for _ in range(3):  # scan up to 3 pages of open markets
                        params = {"limit": 200, "status": "open"}
                        if cursor:
                            params["cursor"] = cursor
                        resp = await client.get(
                            f"{self.base_url}/markets", params=params, timeout=5.0
                        )
                        if resp.status_code != 200:
                            print(f"Kalshi API {resp.status_code}: {resp.text[:120]}")
                            break
                        data = resp.json()
                        for m in data.get("markets", []):
                            title = (m.get("title") or "")
                            hay = f"{title} {m.get('subtitle') or ''}".lower()
                            if not any(t in hay for t in terms):
                                continue
                            yes = m.get("last_price") or m.get("yes_ask") or 0
                            if 0 < yes < 100:
                                results.append({
                                    "question": title,
                                    "yes_price": int(yes),
                                    "no_price": 100 - int(yes),
                                })
                        cursor = data.get("cursor")
                        if len(results) >= 3 or not cursor:
                            break
                except Exception as e:
                    print(f"Kalshi fetch error: {e}")

            if results:
                results = results[:3]
                self._cache[ticker] = (results, time.monotonic())
                return results

            fallback = self.get_fallback_data(ticker)
            if fallback:
                # cache fallback briefly too, so 5-symbol loads stay cheap
                self._cache[ticker] = (fallback, time.monotonic())
            return fallback

    def get_fallback_data(self, symbol: str):
        """Labeled sample data, keyed by SYMBOL (was keyed by name — always missed)."""
        fallbacks = {
            "GC": [
                {"question": "Gold above $2,700 this year? (Sim)", "yes_price": 45, "no_price": 55},
                {"question": "Fed rate cut at next meeting? (Sim)", "yes_price": 68, "no_price": 32},
            ],
            "SI": [
                {"question": "Silver above $35 this quarter? (Sim)", "yes_price": 40, "no_price": 60},
            ],
            "CL": [
                {"question": "WTI above $80 by mid-year? (Sim)", "yes_price": 38, "no_price": 62},
                {"question": "OPEC+ extends production cuts? (Sim)", "yes_price": 75, "no_price": 25},
            ],
            "NG": [
                {"question": "Nat gas above $4 this winter? (Sim)", "yes_price": 30, "no_price": 70},
            ],
            "HG": [
                {"question": "Copper supply deficit this year? (Sim)", "yes_price": 70, "no_price": 30},
            ],
        }
        return fallbacks.get(symbol, [])

kalshi_service = KalshiService()
