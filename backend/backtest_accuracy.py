import asyncio
import os
import sys
from datetime import datetime, timedelta

# Add parent dir to path to import app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import get_db
from app.services.data_engine import data_engine

async def backtest():
    print("--- Starting Backtest Self-Correction ---")
    
    async for db in get_db():
        # 1. Fetch pending recommendations that are at least 7 days old
        # For demonstration purposes in this task, we will also check things older than 1 minute if the user wants 
        # but the request specifically said "7 days ago".
        seven_days_ago = datetime.now() - timedelta(days=7)
        
        rs = await db.execute(
            "SELECT id, symbol, action, price_at_rec, timestamp FROM recommendation_history WHERE status = 'Pending' AND timestamp <= ?",
            [seven_days_ago]
        )
        
        if not rs.rows:
            print("No pending recommendations older than 7 days found.")
            # Let's check if there are ANY pending ones for testing
            rs_any = await db.execute("SELECT count(*) FROM recommendation_history WHERE status = 'Pending'")
            print(f"Total pending recommendations in DB: {rs_any.rows[0][0]}")
            break

        print(f"Found {len(rs.rows)} recommendations to verify...")
        
        for row in rs.rows:
            rec_id, symbol, action, price_at_rec, timestamp = row
            
            # 2. Get current price (as the '7 days later' price)
            data = await data_engine.get_price(symbol)
            current_price = data.get('price', 0.0)
            
            if current_price == 0:
                continue
                
            # 3. Determine if correct
            # ACTION: Buy/Strong Buy -> Price should increase
            # ACTION: Sell/Strong Sell -> Price should decrease
            
            price_diff = current_price - price_at_rec
            is_correct = False
            
            if action in ["Buy", "Strong Buy"]:
                is_correct = price_diff > 0
            elif action in ["Sell", "Strong Sell"]:
                is_correct = price_diff < 0
            
            status = "Correct" if is_correct else "Incorrect"
            
            print(f"[{symbol}] {action} at {price_at_rec} -> Current {current_price} | Result: {status}")
            
            # 4. Update DB
            await db.execute(
                "UPDATE recommendation_history SET status = ?, price_after_7d = ? WHERE id = ?",
                [status, current_price, rec_id]
            )
            
        print("Backtest complete.")
        break

async def seed_test_data():
    """Seed some fake history so we can see the script work immediately."""
    print("Seeding test history (7 days old)...")
    async for db in get_db():
        # Create a successful Buy (Price was lower 7 days ago)
        # We'll use actual current prices but pretend they were lower/higher
        
        test_recs = [
            ("CL", "Buy", 65.0, 85.0, datetime.now() - timedelta(days=8)),
            ("GC", "Sell", 2100.0, 75.0, datetime.now() - timedelta(days=8)),
            ("SI", "Buy", 30.0, 90.0, datetime.now() - timedelta(days=8))
        ]
        
        for symbol, action, price, conf, ts in test_recs:
            await db.execute(
                "INSERT INTO recommendation_history (symbol, action, price_at_rec, confidence, timestamp) VALUES (?, ?, ?, ?, ?)",
                [symbol, action, price, conf, ts]
            )
        print("Test data seeded.")
        break

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--seed":
        asyncio.run(seed_test_data())
    else:
        asyncio.run(backtest())
