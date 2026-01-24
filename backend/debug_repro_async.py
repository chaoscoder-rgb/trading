import asyncio
from app.db import get_db, init_db
from app.services.data_engine import data_engine
from app.services.analytics import analytics_engine

async def test_endpoint():
    print("Initializing DB...")
    await init_db()
    
    print("Getting DB connection...")
    async for db in get_db():
        print("Executing Query...")
        try:
            rs = await db.execute("SELECT symbol, name FROM commodities")
            print(f"Rows found: {len(rs.rows)}")
            if len(rs.rows) > 0:
                print(f"First row: {rs.rows[0]}")
                
            db_commodities = [{"symbol": row[0], "name": row[1]} for row in rs.rows]
            print(f"Mapped Commodities: {db_commodities}")
            
            # just check one
            if db_commodities:
                print("Fetching data...")
                # Mock or real call
                data = await data_engine.get_price(db_commodities[0]['symbol'])
                print(f"Data: {data}")
                
                print(f"Analyzing {db_commodities[0]['symbol']}...")
                analysis = await analytics_engine.generate_enhanced_recommendation(data, db_commodities[0]['symbol'])
                print(f"Analysis Keys: {analysis.keys()}")
                
        except Exception as e:
            print(f"ERROR: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_endpoint())
