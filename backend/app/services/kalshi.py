import httpx
import time
import base64
import json
from datetime import datetime
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding
from app.config import settings

class KalshiService:
    def __init__(self):
        self.api_key = settings.KALSHI_API_KEY
        self.base_url = settings.KALSHI_BASE_URL
        self.private_key = self._load_private_key(settings.KALSHI_RSA_PRIVATE_KEY)

    def _load_private_key(self, key_str):
        if not key_str:
            return None
        try:
            return serialization.load_pem_private_key(
                key_str.encode(),
                password=None
            )
        except Exception as e:
            print(f"Error loading Kalshi private key: {e}")
            return None

    def _sign_request(self, method, path, timestamp):
        if not self.private_key:
            return ""
            
        # Kalshi V2 Auth: Sign "timestamp + method + path"
        msg = f"{timestamp}{method}{path}".encode('utf-8')
        
        signature = self.private_key.sign(
            msg,
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        return base64.b64encode(signature).decode('utf-8')

    async def get_market_data(self, ticker: str):
        """
        Fetch markets using real API if key present, else fallback.
        """
        if not self.private_key or not self.api_key:
            return self.get_fallback_data(ticker)

        # Map to search terms
        keywords = {
            "GC": "Gold", "SI": "Silver", "CL": "Oil", "NG": "Gas", "HG": "Copper",
            "AAPL": "Apple", "TSLA": "Tesla", "NVDA": "Nvidia", "SPY": "S&P 500", "QQQ": "Nasdaq"
        }
        query = keywords.get(ticker, ticker)

        path = "/markets"
        method = "GET"
        timestamp = str(int(time.time() * 1000)) # Milliseconds
        
        # Build query params
        params = {
            "limit": 5, 
            "status": "active",
            "series_ticker": query  # Try series ticker first
        }
        
        # For signature, typically usually just path, sometimes path + query string.
        # Kalshi docs vary, but let's try signing just the path for now or path relative.
        # V2 Docs: timestamp + method + path (e.g. /trade-api/v2/markets)
        
        full_path = "/trade-api/v2/markets"
        signature = self._sign_request(method, full_path, timestamp)

        headers = {
            "WALLETSIG": signature,
            "TIMESTAMP": timestamp,
            "KALSHI-Key": self.api_key,
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient() as client:
            try:
                # Try fetching by query if series lookup fails or is too specific
                # Start with simple search if possible, or filter client side
                
                # First attempt: Get markets broadly
                response = await client.get(
                    f"{self.base_url}/markets",
                    headers=headers,
                    params=params, 
                    timeout=4.0
                )
                
                if response.status_code != 200:
                    print(f"Kalshi API Error: {response.status_code} - {response.text}")
                    return self.get_fallback_data(ticker)
                
                data = response.json()
                markets = data.get("markets", [])
                
                # Process markets
                results = []
                for m in markets:
                    title = m.get("title", "")
                    yes_price = m.get("yes_ask", 0) # Use 'yes_ask' or last price
                    no_price = m.get("no_ask", 0)
                    
                    # Ensure realistic pricing (cents to %)
                    if yes_price > 0:
                        yes_pct = yes_price
                        no_pct = 100 - yes_pct
                        results.append({
                            "question": title,
                            "yes_price": int(yes_pct),
                            "no_price": int(no_pct)
                        })
                
                if not results:
                    return self.get_fallback_data(ticker)
                    
                return results[:3]

            except Exception as e:
                print(f"Kalshi Fetch Error: {e}")
                return self.get_fallback_data(ticker)

    def get_fallback_data(self, keyword: str):
        # ... (Existing fallback logic) ...
        fallbacks = {
            "Gold": [
                {"question": "Gold > $2700 in 2026? (Sim)", "yes_price": 45, "no_price": 55},
                {"question": "Fed rate cut in March? (Sim)", "yes_price": 68, "no_price": 32}
            ],
            "Oil": [
                {"question": "WTI Oil > $80 by June? (Sim)", "yes_price": 38, "no_price": 62},
                {"question": "OPEC+ cuts production? (Sim)", "yes_price": 75, "no_price": 25}
            ],
            # ...
        }
        return fallbacks.get(keyword, [])

kalshi_service = KalshiService()
