import os
import json
import time
import asyncio
import re
import httpx
from datetime import datetime

UNIVERSES_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "universes.json")

KADOA_TRADES_URL = "https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/main/public/data/trades.json"

# Rate-limit pacing for the batch run
MASSIVE_PACING_SEC = 13.0   # free tier: 5 req/min
FINNHUB_PACING_SEC = 1.2    # free tier: 60 req/min

NAME_SUFFIXES = re.compile(
    r"\b(incorporated|inc\.?|corporation|corp\.?|company|co\.?|plc|group|holdings?|"
    r"technologies|technology|international|worldwide|&|the)\b\.?", re.I)


def name_terms(name: str) -> list:
    """'The Coca-Cola Company' -> ['coca-cola']; used to match market questions."""
    cleaned = NAME_SUFFIXES.sub(" ", name or "").strip()
    words = [w.lower() for w in cleaned.split() if len(w) > 1]
    if not words:
        return []
    # first two meaningful words as one phrase + the first word alone if distinctive
    terms = [" ".join(words[:2])] if len(words) >= 2 else []
    if len(words[0]) >= 4 or len(words) == 1:
        terms.append(words[0])
    return list(dict.fromkeys(terms))


class ScreenerService:
    """
    Market-wide screener over index universes (S&P 500, Dow 30).

    Free API tiers can't score ~500 symbols live (Massive: 5 req/min), so a
    nightly batch precomputes per-symbol scores into screener_scores and the
    screener endpoint queries them instantly. Bulk sources (Kalshi/Polymarket
    market scans, kadoa congress trades) are fetched ONCE per run and matched
    locally per symbol.
    """

    BATCH_HOUR_LOCAL = 2  # ~2am server time

    def __init__(self):
        self._running = False
        self._task = None
        with open(UNIVERSES_PATH) as f:
            self.universes = json.load(f)

    # -------------------------------------------------------------- helpers

    def universe_symbols(self, universe: str):
        u = self.universes.get(universe)
        return u["symbols"] if u else []

    def all_symbols(self):
        seen = {}
        for u in self.universes.values():
            for s in u["symbols"]:
                seen[s["symbol"]] = s
        return list(seen.values())

    @staticmethod
    def _match_yes(terms, bulk_markets):
        vals = [m["yes"] for m in bulk_markets
                if any(t in m["title"] for t in terms)]
        return (sum(vals) / len(vals)) if vals else None

    async def _fetch_congress_by_ticker(self):
        """One fetch of kadoa's recent-trades dataset -> {ticker: [types...]}"""
        by_ticker = {}
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(KADOA_TRADES_URL, timeout=20.0, follow_redirects=True)
                resp.raise_for_status()
                for t in resp.json():
                    tick = t.get("ticker")
                    if not tick:
                        continue
                    raw = (t.get("transaction_type") or "").lower()
                    tx = "Purchase" if raw.startswith("purchase") else ("Sale" if raw.startswith("sale") else None)
                    if tx:
                        by_ticker.setdefault(tick, []).append(tx)
        except Exception as e:
            print(f"Screener: congress bulk fetch failed: {e}")
        return by_ticker

    @staticmethod
    def _political_status(txs):
        if not txs:
            return "Neutral"
        recent = txs[:5]
        buys, sells = recent.count("Purchase"), recent.count("Sale")
        if buys > sells:
            return "Bullish Political Flow"
        if sells > buys:
            return "Bearish Political Flow"
        return "Neutral"

    # ------------------------------------------------------------ batch run

    async def run_batch(self, universe: str = None):
        """Score one universe (or the union) into screener_scores."""
        if self._running:
            return {"status": "already_running"}
        self._running = True
        started = datetime.utcnow().isoformat()
        scored = 0
        try:
            from app.db import get_db
            from app.services.data_engine import data_engine
            from app.services.analytics import analytics_engine
            from app.services.kalshi import kalshi_service
            from app.services.polymarket import polymarket_service
            from app.services.fred import fred_service

            symbols = (self.universe_symbols(universe) if universe else self.all_symbols())
            total = len(symbols)
            await self._save_status({"running": True, "started": started,
                                     "scored": 0, "total": total})

            # Bulk sources: one fetch each for the whole run
            kalshi_bulk = await kalshi_service.get_bulk_markets()
            pm_bulk = await polymarket_service.get_bulk_markets()
            congress = await self._fetch_congress_by_ticker()

            # Shared macro score (FRED is cached)
            dxy = await fred_service.get_dollar_index()
            fed = await fred_service.get_fed_funds_rate()
            macro_raw = 50
            if dxy:
                macro_raw += 25 if dxy < 100 else (-25 if dxy > 105 else 0)
            if fed:
                macro_raw += 25 if fed < 3.0 else (-25 if fed > 5.0 else 0)
            macro_score = max(0, min(100, macro_raw))

            for i, s in enumerate(symbols):
                sym, name = s["symbol"], s.get("name", s["symbol"])
                try:
                    # --- bars (Massive; paced only on cache miss) ---
                    was_cached = data_engine._get_cached_bars(sym) is not None
                    bars = await data_engine._get_daily_bars(sym)
                    if not was_cached:
                        await asyncio.sleep(MASSIVE_PACING_SEC)
                    if not bars or len(bars) < 21:
                        continue
                    closes = [b["close"] for b in bars]
                    price = closes[-1]
                    change_pct = ((closes[-1] - closes[-2]) / closes[-2] * 100) if len(closes) > 1 and closes[-2] else 0.0

                    # --- technical score (same shape as the live engine) ---
                    rsi = data_engine._compute_rsi(closes, 14)
                    sma = data_engine._compute_sma(closes, 20)
                    if rsi is None:
                        ti_score = 50.0
                    elif rsi < 30:
                        ti_score = 100.0
                    elif rsi > 70:
                        ti_score = 0.0
                    else:
                        ti_score = 100 - (rsi - 30) * (100 / 40)
                    if sma:
                        ti_score += 20 if price > sma else -20
                    ti_score = max(0, min(100, ti_score))

                    # --- news score (Finnhub; paced) ---
                    news_score = 50.0
                    if analytics_engine.api_key:
                        news = await analytics_engine.fetch_news(sym)
                        news_score = analytics_engine.analyze_sentiment(news)["score"]
                        await asyncio.sleep(FINNHUB_PACING_SEC)

                    # --- bulk-matched signals ---
                    terms = name_terms(name)
                    pm_yes = self._match_yes(terms, pm_bulk) if terms else None
                    ks_yes = self._match_yes(terms, kalshi_bulk) if terms else None
                    pm_score = pm_yes if pm_yes is not None else 50.0
                    political = self._political_status(congress.get(sym))

                    confidence = (news_score * 0.4) + (ti_score * 0.3) + (pm_score * 0.2) + (macro_score * 0.1)
                    if confidence >= 75: action = "Strong Buy"
                    elif confidence >= 55: action = "Buy"
                    elif confidence >= 40: action = "Hold"
                    elif confidence >= 25: action = "Sell"
                    else: action = "Strong Sell"

                    async for db in get_db():
                        await db.execute(
                            """INSERT INTO screener_scores
                               (symbol, name, sector, price, change_percent, confidence, action,
                                ti_score, news_score, pm_score, macro_score, political_status,
                                pm_favor, kalshi_favor, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                               ON CONFLICT(symbol) DO UPDATE SET
                                 name=excluded.name, sector=excluded.sector, price=excluded.price,
                                 change_percent=excluded.change_percent, confidence=excluded.confidence,
                                 action=excluded.action, ti_score=excluded.ti_score,
                                 news_score=excluded.news_score, pm_score=excluded.pm_score,
                                 macro_score=excluded.macro_score, political_status=excluded.political_status,
                                 pm_favor=excluded.pm_favor, kalshi_favor=excluded.kalshi_favor,
                                 updated_at=excluded.updated_at""",
                            [sym, name, s.get("sector"), price, round(change_pct, 2),
                             round(confidence, 1), action, round(ti_score, 1), round(news_score, 1),
                             round(pm_score, 1), macro_score, political,
                             None if pm_yes is None else int(pm_yes > 50),
                             None if ks_yes is None else int(ks_yes > 50),
                             datetime.utcnow().isoformat()],
                        )
                        break
                    scored += 1
                    if scored % 25 == 0:
                        await self._save_status({"running": True, "started": started,
                                                 "scored": scored, "total": total})
                except Exception as e:
                    print(f"Screener: failed scoring {sym}: {e}")

            await self._save_status({"running": False, "started": started,
                                     "completed": datetime.utcnow().isoformat(),
                                     "scored": scored, "total": total})
            return {"status": "completed", "scored": scored, "total": total}
        finally:
            self._running = False

    async def _save_status(self, status: dict):
        try:
            from app.db import get_db
            async for db in get_db():
                await db.execute(
                    "INSERT INTO settings (key, value) VALUES ('screener_status', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    [json.dumps(status)],
                )
                break
        except Exception as e:
            print(f"Screener: status save failed: {e}")

    async def get_status(self, db):
        try:
            rs = await db.execute("SELECT value FROM settings WHERE key = 'screener_status'")
            if rs.rows:
                status = json.loads(rs.rows[0][0])
                status["running"] = self._running
                return status
        except Exception:
            pass
        return {"running": self._running, "scored": 0, "total": 0}

    # --------------------------------------------------------------- query

    async def query(self, db, universe: str, min_confidence=None,
                    political=False, polymarket=False, kalshi=False, limit=100):
        members = {s["symbol"] for s in self.universe_symbols(universe)}
        if not members:
            return {"results": [], "universe": universe, "error": "unknown universe"}

        rs = await db.execute(
            "SELECT symbol, name, sector, price, change_percent, confidence, action, "
            "political_status, pm_favor, kalshi_favor, updated_at FROM screener_scores"
        )
        results = []
        for r in rs.rows:
            (sym, name, sector, price, chg, conf, action, political_status,
             pm_favor, kalshi_favor, updated_at) = r
            if sym not in members:
                continue
            if min_confidence is not None and (conf is None or conf < min_confidence):
                continue
            if political and "Bullish" not in (political_status or ""):
                continue
            if polymarket and pm_favor != 1:
                continue
            if kalshi and kalshi_favor != 1:
                continue
            results.append({
                "symbol": sym, "name": name, "sector": sector, "price": price,
                "change_percent": chg, "confidence": conf, "action": action,
                "political_status": political_status,
                "pm_favor": pm_favor, "kalshi_favor": kalshi_favor,
                "updated_at": updated_at,
            })
        results.sort(key=lambda x: -(x["confidence"] or 0))
        return {"results": results[:limit], "universe": universe,
                "matched": len(results), "universe_size": len(members)}

    # ------------------------------------------------------------ schedule

    async def nightly_loop(self):
        await asyncio.sleep(30)
        while True:
            now = datetime.now()
            target = now.replace(hour=self.BATCH_HOUR_LOCAL, minute=0, second=0, microsecond=0)
            if target <= now:
                from datetime import timedelta
                target += timedelta(days=1)
            await asyncio.sleep((target - now).total_seconds())
            try:
                print("Screener: starting nightly batch")
                await self.run_batch()
            except Exception as e:
                print(f"Screener nightly batch failed: {e}")

    def start(self):
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.nightly_loop())


screener_service = ScreenerService()
