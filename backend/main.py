from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from app.config import settings
from app.config import settings
from app.db import init_db, get_db, Trade, Holding, Commodity, Price
from app.services.data_engine import data_engine
from app.services.analytics import analytics_engine
from pydantic import BaseModel
from typing import Optional

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
def on_startup():
    init_db()

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
async def add_commodity(commodity: CommodityRequest, db: Session = Depends(get_db)):
    # Check if exists
    existing = db.query(Commodity).filter(Commodity.symbol == commodity.symbol).first()
    if existing:
        return existing
        
    new_commodity = Commodity(symbol=commodity.symbol, name=commodity.name)
    db.add(new_commodity)
    db.commit()
    db.refresh(new_commodity)
    return new_commodity

@app.delete("/api/commodities/{symbol}")
async def delete_commodity(symbol: str, db: Session = Depends(get_db)):
    # Delete associated prices first to satisfy Foreign Key
    db.query(Price).filter(Price.commodity_symbol == symbol).delete()
    
    # Check item
    item = db.query(Commodity).filter(Commodity.symbol == symbol).first()
    if item:
        db.delete(item)
        db.commit()
        return {"status": "success", "message": f"{symbol} removed"}
    return {"status": "error", "message": "Not found"}

@app.get("/api/commodities")
async def get_commodities(db: Session = Depends(get_db)):
    # Fetch from DB
    items = db.query(Commodity).all()
    
    results = []
    for item in items:
        symbol = item.symbol
        name = item.name
    
        price_data = await data_engine.get_price(symbol)
        risk = analytics_engine.calculate_risk(price_data)
        recommendation = await analytics_engine.generate_enhanced_recommendation(price_data, symbol)
        
        results.append({
            "symbol": symbol,
            "name": name,
            "price": price_data.get("price"),
            "risk": risk,
            "recommendation": recommendation
        })
    return results

@app.get("/api/holdings")
async def get_holdings(db: Session = Depends(get_db)):
    return db.query(Holding).all()

@app.post("/api/holdings")
async def create_holding(holding: HoldingRequest, db: Session = Depends(get_db)):
    db_holding = Holding(
        symbol=holding.symbol,
        quantity=holding.quantity,
        avg_price=holding.avg_price
    )
    db.add(db_holding)
    db.commit()
    db.refresh(db_holding)
    return db_holding

@app.put("/api/holdings/{id}")
async def update_holding(id: int, holding: HoldingRequest, db: Session = Depends(get_db)):
    db_holding = db.query(Holding).filter(Holding.id == id).first()
    if db_holding:
        db_holding.quantity = holding.quantity
        db_holding.avg_price = holding.avg_price
        db.commit()
        db.refresh(db_holding)
    return db_holding

@app.delete("/api/holdings/{id}")
async def delete_holding(id: int, db: Session = Depends(get_db)):
    db_holding = db.query(Holding).filter(Holding.id == id).first()
    if db_holding:
        db.delete(db_holding)
        db.commit()
    return {"status": "success"}

@app.post("/api/trade")
async def place_trade(trade: TradeRequest, db: Session = Depends(get_db)):
    # 1a. Prepare Trade Record
    # We will finalize and add it AFTER checking holdings logic to get correct cost basis for SELL
    
    cost_basis_val = None
    
    # 2. Update Holdings
    # Check if holding exists
    existing_holding = db.query(Holding).filter(Holding.symbol == trade.symbol).first()
    
    if trade.action == "BUY":
        if existing_holding:
            # Calculate new weighted average price
            total_cost = (existing_holding.quantity * existing_holding.avg_price) + (trade.amount * trade.price)
            total_qty = existing_holding.quantity + trade.amount
            existing_holding.avg_price = total_cost / total_qty
            existing_holding.quantity = total_qty
        else:
            # Create new holding
            new_holding = Holding(
                symbol=trade.symbol,
                quantity=trade.amount,
                avg_price=trade.price
            )
            db.add(new_holding)
            
    elif trade.action == "SELL":
        if existing_holding:
            # Capture cost basis BEFORE selling
            cost_basis_val = existing_holding.avg_price
            
            if existing_holding.quantity > trade.amount:
                existing_holding.quantity -= trade.amount
            elif existing_holding.quantity == trade.amount:
                db.delete(existing_holding)
            else:
                db.delete(existing_holding)
        else:
            # Short selling logic or error? For MVP, just allow but no cost basis
            cost_basis_val = 0.0

    # 1b. Create Trade Record now that we have cost basis
    new_trade = Trade(
        commodity_symbol=trade.symbol,
        type=trade.action,
        price=trade.price,
        amount=trade.amount,
        cost_basis=cost_basis_val,
        is_paper=True
    )
    db.add(new_trade)
    
    db.commit()
    db.refresh(new_trade)
    
    # 3. Send Email Notification
    from app.services.email_service import email_service
    email_service.send_trade_confirmation({
        "action": trade.action,
        "symbol": trade.symbol,
        "amount": trade.amount,
        "price": trade.price
    })
    
    return {"status": "success", "trade_id": new_trade.id}

@app.get("/api/history")
async def get_trade_history(db: Session = Depends(get_db)):
    # Return sales history (descending date)
    return db.query(Trade).filter(Trade.type == "SELL").order_by(Trade.timestamp.desc()).all()
