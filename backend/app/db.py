import os
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from datetime import datetime
from app.config import settings

# Determine DB URL
# If config provides TURSO_DB_URL, use it. Otherwise fallback to local sqlite for dev?
# For now, let's assume we want to use the configured Turso DB or a local sqlite file if not ready.
# If settings.TURSO_DB_URL starts with libsql://, we need a specific driver or url format for sqlalchemy
# "sqlite+pysqlite:///:memory:" is default. 
# For Turso with sqlalchemy, we typically use "sqlite+libsql://..." url if creating the engine with specific dialect
# Or standard sqlite if using a local file.

# Given the env file has libsql://, we can try to use it directly if using correct driver.
# But for simplicity in this MVP step, if the user wants local dev and the url is weird, 
# we might want to default to a local sqlite file to ensure it works immediately without complex auth setup debugging.
# However, the user provided a token.

# Let's try to construct a valid URL.
# Turso Connection Logic (Reverted to Local for now due to driver issues)
# db_url = settings.TURSO_DB_URL
# ... (Turso logic commented out)

# Fallback to local
SQLITE_URL = "sqlite:///./trading.db"

engine = create_engine(
    SQLITE_URL, 
    connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Commodity(Base):
    __tablename__ = "commodities"
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, unique=True, index=True)
    name = Column(String)
    
class Price(Base):
    __tablename__ = "prices"
    id = Column(Integer, primary_key=True, index=True)
    commodity_symbol = Column(String, ForeignKey("commodities.symbol"))
    price = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)

class Trade(Base):
    __tablename__ = "trades"
    id = Column(Integer, primary_key=True, index=True)
    commodity_symbol = Column(String)
    type = Column(String) # BUY / SELL
    price = Column(Float)
    amount = Column(Float)
    cost_basis = Column(Float, nullable=True) # Avg price of holding at time of sale (for P/L)
    timestamp = Column(DateTime, default=datetime.utcnow)
    is_paper = Column(Boolean, default=True)

class Holding(Base):
    __tablename__ = "holdings"
    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, unique=True, index=True)
    quantity = Column(Float)
    avg_price = Column(Float)
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    

def init_db():
    Base.metadata.create_all(bind=engine)
    seed_commodities()

def seed_commodities():
    db = SessionLocal()
    try:
        # Check if empty
        if db.query(Commodity).count() == 0:
            defaults = [
                {"symbol": "CL", "name": "Crude Oil"},
                {"symbol": "GC", "name": "Gold"},
                {"symbol": "SI", "name": "Silver"},
                {"symbol": "HG", "name": "Copper"},
                {"symbol": "NG", "name": "Natural Gas"}
            ]
            for item in defaults:
                db_item = Commodity(symbol=item["symbol"], name=item["name"])
                db.add(db_item)
            db.commit()
            print("Seeded default commodities.")
    except Exception as e:
        print(f"Error seeding DB: {e}")
    finally:
        db.close()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
