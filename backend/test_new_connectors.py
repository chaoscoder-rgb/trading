"""
Smoke test for the new public-API connectors (run from backend/):

    python test_new_connectors.py [SYMBOL]

Hits each live API once and prints what came back. Keyless sources
(Goldprice.dev, World Bank, Treasury, Tradestie WSB) should return real data
immediately; Econdb and MarketAux report "disabled" until their free tokens
are added to .env.
"""
import sys
import asyncio


async def main(symbol: str):
    from app.services.metals import metals_service
    from app.services.fundamentals import fundamentals_service
    from app.services.wsb import wsb_service
    from app.services.marketaux import marketaux_service
    from app.config import settings

    print(f"=== Goldprice.dev (metals: GC/SI/HG) ===")
    for s in ("GC", "SI", "HG"):
        spot = await metals_service.get_spot(s)
        print(f"  {s}: {spot if spot else 'FAILED (check network / rate limit)'}")

    print(f"\n=== Fundamentals pillar for {symbol} ===")
    f = await fundamentals_service.get_fundamentals(symbol)
    print(f"  score: {f['score']}")
    for sig in f["signals"]:
        print(f"  - {sig}")
    for k, v in f["sources"].items():
        print(f"  [{k}] {v}")

    print(f"\n=== Tradestie r/WSB sentiment ===")
    w = await wsb_service.get_sentiment(symbol)
    print(f"  {symbol}: {w if w else 'not in top-50 discussed tickers (normal for quiet names)'}")
    w2 = await wsb_service.get_sentiment("TSLA")
    print(f"  TSLA (control): {w2 if w2 else 'FAILED — API unreachable?'}")

    print(f"\n=== MarketAux news sentiment ===")
    if not settings.MARKETAUX_API_TOKEN:
        print("  disabled — add MARKETAUX_API_TOKEN to .env (free at marketaux.com)")
    else:
        m = await marketaux_service.get_news_sentiment(symbol)
        print(f"  {symbol}: score={m['score'] if m else 'FAILED'}")
        if m:
            for a in m["articles"][:3]:
                print(f"  - [{a['sentiment']}] {a['title']}")

    if not settings.ECONDB_API_TOKEN:
        print("\n(Econdb US industrial production disabled — add ECONDB_API_TOKEN for it)")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "GC"))
