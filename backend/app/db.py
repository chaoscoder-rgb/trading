import os
import libsql_client
from datetime import datetime
from app.config import settings

# Database Configuration
TURSO_URL = settings.TURSO_DB_URL
TURSO_TOKEN = settings.TURSO_AUTH_TOKEN

async def get_db():
    # Use async client for better compatibility on Windows (HTTP)
    url = TURSO_URL
    if url and url.startswith("libsql://"):
        url = url.replace("libsql://", "https://")
        
    if not url:
        url = "file:trading.db"

    # Use context manager to handle connection/cleanup automatically
    async with libsql_client.create_client(url, auth_token=TURSO_TOKEN) as client:
        yield client

async def init_db():
    print("Initializing Database (Async)...")
    url = TURSO_URL
    if url and url.startswith("libsql://"):
        url = url.replace("libsql://", "https://")
    if not url: url = "file:trading.db"

    async with libsql_client.create_client(url, auth_token=TURSO_TOKEN) as client:
        try:
            # Create Tables
            # Commodities
            await client.execute("""
                CREATE TABLE IF NOT EXISTS commodities (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT UNIQUE,
                    name TEXT
                )
            """)
            
            # Prices
            await client.execute("""
                CREATE TABLE IF NOT EXISTS prices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    commodity_symbol TEXT,
                    price REAL,
                    timestamp DATETIME,
                    FOREIGN KEY(commodity_symbol) REFERENCES commodities(symbol)
                )
            """)
            
            # Trades
            await client.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    commodity_symbol TEXT,
                    type TEXT,
                    price REAL,
                    amount REAL,
                    cost_basis REAL,
                    timestamp DATETIME,
                    is_paper BOOLEAN
                )
            """)
            
            # Holdings
            await client.execute("""
                CREATE TABLE IF NOT EXISTS holdings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT UNIQUE,
                    quantity REAL,
                    avg_price REAL,
                    last_updated DATETIME
                )
            """)
            
            # Recommendation History (for Self-Correction/Backtesting)
            await client.execute("""
                CREATE TABLE IF NOT EXISTS recommendation_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT,
                    action TEXT,
                    price_at_rec REAL,
                    confidence REAL,
                    timestamp DATETIME,
                    status TEXT DEFAULT 'Pending', -- Pending, Correct, Incorrect
                    price_after_7d REAL
                )
            """)
            
            await seed_commodities(client)
            print("Database Initialized.")
        except Exception as e:
            print(f"DB Init Failed: {e}")

async def seed_commodities(client):
    try:
        # Check if empty
        rs = await client.execute("SELECT count(*) FROM commodities")
        count = rs.rows[0][0]
        
        if count == 0:
            defaults = [
                ("CL", "Crude Oil"),
                ("GC", "Gold"),
                ("SI", "Silver"),
                ("HG", "Copper"),
                ("NG", "Natural Gas")
            ]
            for symbol, name in defaults:
                await client.execute("INSERT INTO commodities (symbol, name) VALUES (?, ?)", [symbol, name])
            print("Seeded default commodities.")
    except Exception as e:
        print(f"Error seeding DB: {e}")
