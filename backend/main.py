from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db import init_db, get_db
# Remove SQLAlchemy imports
# from app.db import Trade, Holding, Commodity, Price 
from app.services.data_engine import data_engine
from app.services.analytics import analytics_engine
from app.services.email_service import email_service
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

# 1. Initialize App
app = FastAPI(title="TradeVision API")

# 2. Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Startup Event
@app.on_event("startup")
async def on_startup():
    await init_db()

# 4. Models
class CommodityRequest(BaseModel):
    symbol: str
    name: str

class HoldingRequest(BaseModel):
    symbol: str
    quantity: float
    avg_price: float

class TradeRequest(BaseModel):
    symbol: str
    action: str # BUY/SELL
    amount: float
    price: float

# Helper to dict
def row_to_dict(cols, row):
    return dict(zip(cols, row))

# 5. Endpoints
@app.get("/")
async def root():
    return {"message": "TradeVision API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/commodities/search")
async def search_commodities(query: str):
    return await data_engine.search_symbols(query)

@app.post("/api/commodities")
async def add_commodity(commodity: CommodityRequest, db = Depends(get_db)):
    # Check if exists
    rs = await db.execute("SELECT * FROM commodities WHERE symbol = ?", [commodity.symbol])
    if rs.rows:
        return {"symbol": rs.rows[0][1], "name": rs.rows[0][2]}
        
    await db.execute("INSERT INTO commodities (symbol, name) VALUES (?, ?)", [commodity.symbol, commodity.name])
    return {"symbol": commodity.symbol, "name": commodity.name}

@app.delete("/api/commodities/{symbol}")
async def delete_commodity(symbol: str, db = Depends(get_db)):
    # Delete associated prices first
    await db.execute("DELETE FROM prices WHERE commodity_symbol = ?", [symbol])
    
    # Delete commodity
    rs = await db.execute("DELETE FROM commodities WHERE symbol = ?", [symbol])
    
    return {"status": "success", "message": f"{symbol} removed"}

@app.get("/api/commodities")
async def get_commodities(db = Depends(get_db)):
    # Get all commodities
    rs = await db.execute("SELECT symbol, name FROM commodities")
    
    # Map results to list of dicts. Note: rs.rows are tuples in libsql-client
    # Adjusting index to 0,1 as checked in previous turn
    db_commodities = [{"symbol": row[0], "name": row[1]} for row in rs.rows]
    
    results = []
    for com in db_commodities:
        symbol = com['symbol']
        # Fetch Real-Time Data (or cache)
        # Note: get_price might fail if no price is available yet
        data = await data_engine.get_price(symbol) 
        
        # Analyze
        analysis = await analytics_engine.generate_enhanced_recommendation(data, symbol)
        
        # Calculate Risk (Simple/Mock if needed, or use analysis)
        # Frontend expects risk.level
        
        # Calculate Dynamic Risk based on Confidence
        confidence_score = analysis.get('confidence', 0.0)
        if confidence_score > 80:
            risk_level = "Low"
        elif confidence_score > 50:
            risk_level = "Medium"
        else:
            risk_level = "High"

        results.append({
            "id": symbol,
            "symbol": symbol,
            "name": com['name'],
            "price": data.get('price', 0.0),
            "change": data.get('change', 0.0),
            "changePercent": data.get('change_percent', 0.0),
            "risk": {"level": risk_level},
            "recommendation": {
                "action": analysis['action'],
                "confidence": analysis['confidence'],
                "reason": analysis['reason'],
                "analysis": analysis['analysis'],
                "polls": analysis.get('polls', [])
            }
        })
    return results

@app.get("/api/holdings")
async def get_holdings(db = Depends(get_db)):
    rs = await db.execute("SELECT id, symbol, quantity, avg_price, last_updated FROM holdings")
    holdings = []
    for row in rs.rows:
        holdings.append({
            "id": row[0],
            "symbol": row[1],
            "quantity": row[2],
            "avg_price": row[3],
            "last_updated": row[4]
        })
    return holdings

@app.put("/api/holdings/{id}")
async def update_holding(id: int, holding: HoldingRequest, db = Depends(get_db)):
    # Update quantity and avg_price
    timestamp = datetime.utcnow()
    await db.execute(
        "UPDATE holdings SET quantity = ?, avg_price = ?, last_updated = ? WHERE id = ?",
        [holding.quantity, holding.avg_price, timestamp, id]
    )
    return {"status": "success", "message": "Holding updated"}

@app.get("/api/history")
async def get_history(db = Depends(get_db)):
    rs = await db.execute("SELECT id, commodity_symbol, type, price, amount, cost_basis, timestamp FROM trades ORDER BY timestamp DESC")
    history = []
    for row in rs.rows:
        history.append({
            "id": row[0],
            "commodity_symbol": row[1],
            "type": row[2],
            "price": row[3],
            "amount": row[4],
            "cost_basis": row[5],
            "timestamp": row[6]
        })
    return history

@app.post("/api/trade")
async def execute_trade(trade: TradeRequest, background_tasks: BackgroundTasks, db = Depends(get_db)):
    # 1. Log Trade
    timestamp = datetime.utcnow()
    cost_basis = 0.0
    
    # If Selling, calculate cost basis from current holdings
    # Update Holding
    rs = await db.execute("SELECT id, quantity, avg_price FROM holdings WHERE symbol = ?", [trade.symbol])
    holding = rs.rows[0] if rs.rows else None
    
    if trade.action == "BUY":
        new_qty = trade.amount
        total_cost = trade.amount * trade.price
        
        if holding:
            current_qty = holding[1]
            current_avg = holding[2]
            total_qty = current_qty + new_qty
            new_avg = ((current_qty * current_avg) + total_cost) / total_qty
            
            await db.execute(
                "UPDATE holdings SET quantity = ?, avg_price = ?, last_updated = ? WHERE id = ?",
                [total_qty, new_avg, timestamp, holding[0]]
            )
        else:
            await db.execute(
                "INSERT INTO holdings (symbol, quantity, avg_price, last_updated) VALUES (?, ?, ?, ?)",
                [trade.symbol, new_qty, trade.price, timestamp]
            )
            
    elif trade.action == "SELL":
        if not holding:
            raise HTTPException(status_code=400, detail="No holdings to sell")
        
        current_qty = holding[1]
        current_avg = holding[2]
        cost_basis = current_avg # For this sale
        
        if current_qty < trade.amount:
            raise HTTPException(status_code=400, detail="Insufficient quantity")
            
        remaining_qty = current_qty - trade.amount
        
        if remaining_qty <= 0: # handling float precision or exact zero
             await db.execute("DELETE FROM holdings WHERE id = ?", [holding[0]])
        else:
             # Avg price doesn't change on sell (FIFO/Avg Cost assumption)
             await db.execute(
                "UPDATE holdings SET quantity = ?, last_updated = ? WHERE id = ?",
                [remaining_qty, timestamp, holding[0]]
             )
    
    # Log the trade
    await db.execute(
        """INSERT INTO trades (commodity_symbol, type, price, amount, cost_basis, timestamp, is_paper) 
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [trade.symbol, trade.action, trade.price, trade.amount, cost_basis, timestamp, True]
    )

    # 2. Identify Email Recipient
    # User's email from env
    # 2. Trigger Email Notification
    trade_details = {
        "action": trade.action,
        "symbol": trade.symbol,
        "price": trade.price,
        "amount": trade.amount,
        "date": timestamp
    }
    
    if trade.action == "SELL":
        pnl = (trade.price - cost_basis) * trade.amount
        trade_details['profit_loss'] = pnl
        
    background_tasks.add_task(email_service.send_trade_confirmation, trade_details)

    return {
        "status": "success",
        "trade_id": "new", # SQLite doesn't return ID easily on partial insert without returning clause
        "message": f"Trade {trade.action} executed"
    }
