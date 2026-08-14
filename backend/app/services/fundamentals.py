"""
Fundamentals pillar — global supply/demand context from free public APIs
(all from the public-apis catalog):

- World Bank (no key): world GDP growth, industry value-added growth,
  world CPI inflation — demand-side context for commodities.
- US Treasury Fiscal Data (no key): total public debt, YoY growth — fiscal
  expansion is a tailwind for hard assets (gold/silver).
- Econdb (optional free token, ECONDB_API_TOKEN): US industrial production
  YoY — a higher-frequency demand proxy for energy/copper.

This feeds the previously-missing "Fundamentals" factor of the consensus
(spec weights: Technical 40 / Fundamentals 30 / Sentiment 20 / Macro 10).
Everything degrades gracefully: with no network/keys the pillar returns a
neutral 50 and says so.
"""
import time
import asyncio
import httpx
from app.config import settings

WB_BASE = settings.WORLDBANK_BASE_URL
TREASURY_BASE = settings.TREASURY_FISCAL_BASE_URL
ECONDB_BASE = settings.ECONDB_BASE_URL

# Commodity classes drive how each factor is interpreted
PRECIOUS = {"GC", "SI"}                 # store-of-value assets
INDUSTRIAL = {"CL", "NG", "HG"}         # demand tied to industrial activity


class FundamentalsService:
    CACHE_TTL = 6 * 3600  # macro fundamentals move slowly; 6h cache

    def __init__(self):
        self._cache = {}   # key -> (value, fetched_at)
        self._locks = {}   # key -> asyncio.Lock

    # ------------------------------------------------------------- caching

    def _get_cached(self, key: str):
        hit = self._cache.get(key)
        if hit is not None:
            value, fetched_at = hit
            if time.monotonic() - fetched_at < self.CACHE_TTL:
                return value
        return None

    async def _cached_fetch(self, key: str, fetch_coro_factory):
        cached = self._get_cached(key)
        if cached is not None:
            return cached
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self._get_cached(key)
            if cached is not None:
                return cached
            try:
                value = await fetch_coro_factory()
            except Exception as e:
                # repr(): some httpx errors (ReadError etc.) stringify empty
                print(f"Fundamentals fetch failed for {key}: {e!r}")
                value = None
            if value is not None:
                self._cache[key] = (value, time.monotonic())
            return value

    # ------------------------------------------------------- World Bank

    async def _worldbank_latest(self, indicator: str):
        """Latest non-null value for a World Bank indicator (world aggregate)."""
        async def fetch():
            # follow_redirects matters: api.worldbank.org 3xx-redirects some
            # requests, and an unfollowed redirect looked like a dead source.
            async with httpx.AsyncClient(follow_redirects=True) as client:
                resp = await client.get(
                    f"{WB_BASE}/country/WLD/indicator/{indicator}",
                    params={"format": "json", "per_page": 10, "mrnev": 1},
                    timeout=6.0,
                )
                if resp.status_code != 200:
                    return None
                data = resp.json()
                # Shape: [meta, [{"date": "2025", "value": 3.1, ...}, ...]]
                if not isinstance(data, list) or len(data) < 2 or not data[1]:
                    return None
                for row in data[1]:
                    if row.get("value") is not None:
                        return {"value": float(row["value"]), "year": row.get("date")}
                return None
        return await self._cached_fetch(f"wb:{indicator}", fetch)

    async def get_world_gdp_growth(self):
        return await self._worldbank_latest("NY.GDP.MKTP.KD.ZG")

    async def get_world_industry_growth(self):
        return await self._worldbank_latest("NV.IND.TOTL.KD.ZG")

    async def get_world_inflation(self):
        return await self._worldbank_latest("FP.CPI.TOTL.ZG")

    # ------------------------------------------------- US Treasury (fiscal)

    async def get_us_debt_growth(self):
        """YoY growth (%) of total US public debt outstanding."""
        async def fetch():
            async with httpx.AsyncClient(follow_redirects=True) as client:
                url = f"{TREASURY_BASE}/v2/accounting/od/debt_to_penny"
                latest = await client.get(
                    url, params={"sort": "-record_date", "page[size]": 1},
                    timeout=6.0,
                )
                if latest.status_code != 200:
                    return None
                rows = latest.json().get("data") or []
                if not rows:
                    return None
                latest_row = rows[0]
                latest_debt = float(latest_row["tot_pub_debt_out_amt"])
                latest_date = latest_row["record_date"]          # YYYY-MM-DD

                year_ago = f"{int(latest_date[:4]) - 1}{latest_date[4:]}"
                prior = await client.get(
                    url,
                    params={"sort": "-record_date", "page[size]": 1,
                            "filter": f"record_date:lte:{year_ago}"},
                    timeout=6.0,
                )
                if prior.status_code != 200:
                    return None
                prows = prior.json().get("data") or []
                if not prows:
                    return None
                prior_debt = float(prows[0]["tot_pub_debt_out_amt"])
                if prior_debt <= 0:
                    return None
                return {
                    "growth_pct": (latest_debt - prior_debt) / prior_debt * 100,
                    "as_of": latest_date,
                }
        return await self._cached_fetch("treasury:debt_growth", fetch)

    # --------------------------------------------------- Econdb (optional)

    async def get_us_industrial_production_yoy(self):
        """US industrial production YoY (%) via Econdb. Needs free token."""
        if not settings.ECONDB_API_TOKEN:
            return None

        async def fetch():
            async with httpx.AsyncClient(follow_redirects=True) as client:
                resp = await client.get(
                    f"{ECONDB_BASE}/series/",
                    params={"ticker": "IPUS", "format": "json",
                            "token": settings.ECONDB_API_TOKEN},
                    timeout=6.0,
                )
                if resp.status_code != 200:
                    return None
                data = resp.json()
                values = (data.get("data") or {}).get("values") or []
                dates = (data.get("data") or {}).get("dates") or []
                series = [(d, v) for d, v in zip(dates, values) if v is not None]
                if len(series) < 13:
                    return None
                latest_date, latest_val = series[-1]
                _, prior_val = series[-13]  # ~12 months back (monthly series)
                if not prior_val:
                    return None
                return {
                    "yoy_pct": (latest_val - prior_val) / prior_val * 100,
                    "as_of": latest_date,
                }
        return await self._cached_fetch("econdb:IPUS_yoy", fetch)

    # ----------------------------------------------------------- scoring

    async def get_fundamentals(self, symbol: str) -> dict:
        """
        Fundamentals score 0-100 for a symbol (50 = neutral) with a
        transparent signals list, from World Bank + Treasury + Econdb.
        """
        gdp, industry, inflation, debt, us_ip = await asyncio.gather(
            self.get_world_gdp_growth(),
            self.get_world_industry_growth(),
            self.get_world_inflation(),
            self.get_us_debt_growth(),
            self.get_us_industrial_production_yoy(),
        )

        score = 50.0
        signals = []

        if gdp:
            v = gdp["value"]
            if v > 3.0:
                score += 15; signals.append(f"Global GDP growth {v:.1f}% — demand expanding (World Bank {gdp['year']})")
            elif v < 2.0:
                score -= 15; signals.append(f"Global GDP growth {v:.1f}% — demand weak (World Bank {gdp['year']})")
            else:
                signals.append(f"Global GDP growth {v:.1f}% — neutral (World Bank {gdp['year']})")

        if industry:
            v = industry["value"]
            weight = 12 if symbol in INDUSTRIAL else 6
            if v > 2.5:
                score += weight; signals.append(f"World industry output +{v:.1f}% — industrial demand tailwind")
            elif v < 1.0:
                score -= weight; signals.append(f"World industry output {v:.1f}% — industrial demand headwind")

        if inflation:
            v = inflation["value"]
            if symbol in PRECIOUS:
                if v > 4.0:
                    score += 12; signals.append(f"World inflation {v:.1f}% — store-of-value bid for precious metals")
                elif v < 2.0:
                    score -= 8; signals.append(f"World inflation {v:.1f}% — weak inflation hedge demand")
            else:
                if v > 6.0:
                    score -= 5; signals.append(f"World inflation {v:.1f}% — cost pressure risk")

        if debt:
            v = debt["growth_pct"]
            if symbol in PRECIOUS:
                if v > 8.0:
                    score += 10; signals.append(f"US public debt +{v:.1f}% YoY — fiscal expansion favors hard assets (Treasury)")
                elif v < 4.0:
                    score -= 5; signals.append(f"US public debt +{v:.1f}% YoY — fiscal restraint (Treasury)")

        if us_ip:
            v = us_ip["yoy_pct"]
            if symbol in INDUSTRIAL:
                if v > 2.0:
                    score += 10; signals.append(f"US industrial production +{v:.1f}% YoY — energy/metals demand up (Econdb)")
                elif v < 0.0:
                    score -= 10; signals.append(f"US industrial production {v:.1f}% YoY — contraction (Econdb)")

        if not signals:
            signals.append("Fundamentals data unavailable — neutral")

        return {
            "score": max(0.0, min(100.0, round(score, 1))),
            "signals": signals,
            "sources": {
                "world_gdp_growth": gdp,
                "world_industry_growth": industry,
                "world_inflation": inflation,
                "us_debt_growth": debt,
                "us_industrial_production_yoy": us_ip,
            },
        }


fundamentals_service = FundamentalsService()
