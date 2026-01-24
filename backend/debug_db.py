from app.config import settings
from sqlalchemy import create_engine, text
import urllib.parse
import sys

print("Testing Turso Connection...")
print(f"URL from env: {settings.TURSO_DB_URL}")
print(f"Token length: {len(settings.TURSO_AUTH_TOKEN)}")

db_url = settings.TURSO_DB_URL
if db_url and db_url.startswith("libsql://"):
    db_url = db_url.replace("libsql://", "sqlite+libsql://")
    if settings.TURSO_AUTH_TOKEN:
        encoded_token = urllib.parse.quote_plus(settings.TURSO_AUTH_TOKEN)
        db_url = f"{db_url}?authToken={encoded_token}&secure=true"

print(f"Constructed URL (masked): {db_url.split('?')[0]}?authToken=***")

try:
    engine = create_engine(db_url, connect_args={})
    with engine.connect() as conn:
        print("Connection successful!")
        result = conn.execute(text("SELECT 1"))
        print(f"Test Query Result: {result.fetchone()}")
        
        # Check tables
        result = conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        tables = [row[0] for row in result.fetchall()]
        print(f"Tables: {tables}")
except Exception as e:
    print(f"Connection Failed: {e}")
    sys.exit(1)
