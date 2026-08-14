"""
MarketAux news sentiment — ticker-tagged articles with per-entity NLP
sentiment scores (public-apis catalog; free tier, key required:
MARKETAUX_API_TOKEN, sign up at marketaux.com).

This upgrades sentiment from keyword counting toward real scored NLP
(backlog M1): each article's entities carry sentiment_score in -1..1.
Commodities use the same ETF proxy mapping as the other news sources.
Without a token the service is silently inactive.
"""
import time
import asyncio
import httpx
from app.config import settings

PROXY = {"GC": "GLD", "SI": "SLV", "CL": "USO", "NG": "UNG", "HG": "CPER"}


class MarketauxService:
    BASE_URL = settings.MARKETAUX_BASE_URL
    CACHE_TTL = 1800  # 30 min — free tier has a small daily request budget

    def __init__(self):
        self._cache = {}   # ticker -> (payload, fetched_at)
        self._locks = {}   # ticker -> asyncio.Lock

    @property
    def enabled(self) -> bool:
        return bool(settings.MARKETAUX_API_TOKEN)

    def _get_cached(self, ticker: str):
        hit = self._cache.get(ticker)
        if hit is not None:
            payload, fetched_at = hit
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return payload
        return None

    async def get_news_sentiment(self, symbol: str):
        """
        Scored news sentiment for a symbol (or its ETF proxy).
        Returns {"score": 0-100, "articles": [{title, url, source,
                 sentiment: -1..1}], "ticker"} or None when disabled/failed.
        """
        if not self.enabled:
            return None

        ticker = PROXY.get(symbol, symbol).upper()
        cached = self._get_cached(ticker)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(ticker, asyncio.Lock())
        async with lock:
            cached = self._get_cached(ticker)
            if cached is not None:
                return cached
            try:
                async with httpx.AsyncClient(follow_redirects=True) as client:
                    resp = await client.get(
                        f"{self.BASE_URL}/news/all",
                        params={
                            "symbols": ticker,
                            "filter_entities": "true",
                            "language": "en",
                            "limit": 10,
                            "api_token": settings.MARKETAUX_API_TOKEN,
                        },
                        timeout=6.0,
                    )
                    if resp.status_code != 200:
                        print(f"MarketAux HTTP {resp.status_code} for {ticker}")
                        return None
                    articles = []
                    scores = []
                    for art in resp.json().get("data") or []:
                        ent_scores = [
                            e.get("sentiment_score")
                            for e in art.get("entities") or []
                            if e.get("symbol", "").upper() == ticker
                            and e.get("sentiment_score") is not None
                        ]
                        s = sum(ent_scores) / len(ent_scores) if ent_scores else None
                        if s is not None:
                            scores.append(s)
                        articles.append({
                            "title": art.get("title"),
                            "url": art.get("url"),
                            "source": art.get("source"),
                            "sentiment": round(s, 3) if s is not None else None,
                        })
                    if not scores:
                        return None
                    avg = sum(scores) / len(scores)      # -1..1
                    payload = {
                        "score": round(max(0.0, min(100.0, 50.0 + avg * 50.0)), 1),
                        "articles": articles,
                        "ticker": ticker,
                    }
                    self._cache[ticker] = (payload, time.monotonic())
                    return payload
            except Exception as e:
                print(f"MarketAux fetch failed for {ticker}: {e}")
                return None


marketaux_service = MarketauxService()
