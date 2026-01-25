import httpx
from app.config import settings

class DataEngine:
    BASE_URL = settings.TWELVEDATA_BASE_URL
    API_KEY = settings.TWELVEDATA_API_KEY
    
    SIM_PRICES = {
        "GC": 2650.00,
        "SI": 31.50,
        "CL": 74.20,
        "HG": 4.15,
        "NG": 2.85,
        "AAPL": 248.00,
        "TSLA": 415.00,
        "NVDA": 135.00,
        "AMD": 175.00,
        "MSFT": 450.00,
        "GOOGL": 190.00,
        "AMZN": 205.00,
        "SPY": 590.00,
        "QQQ": 510.00
    }
    
    async def get_price(self, symbol: str):
        """
        Fetch real-time price for a commodity/symbol.
        """
        import random
        
        # Map generic symbols to API specific symbols (Twelve Data) if needed
        # For new custom added symbols, we expect the user to add the correct ticker (e.g. AAPL)
        # But we keep the map for the legacy default commodities
        SYMBOL_MAP = {
            "GC": "XAU/USD", # Gold
            "SI": "XAG/USD", # Silver
            "CL": "WTI/USD", # Crude Oil
            "HG": "XCU/USD", # Copper
            "NG": "XNG/USD"  # Natural Gas
        }
        
        api_symbol = SYMBOL_MAP.get(symbol, symbol)

        # If key is missing:
        if not self.API_KEY:
             return self._simulate_price(symbol, self.SIM_PRICES.get(symbol, 100.0))

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.BASE_URL}/price",
                    params={"symbol": api_symbol, "apikey": self.API_KEY},
                    timeout=3.0
                )
                
                data = response.json()
                
                if "price" in data:
                    return {"symbol": symbol, "price": float(data["price"])}
                
                # If API fails or returns error, use SIMULATION (Robust MVP)
                print(f"API Error for {symbol} ({api_symbol}): {data}")
                return self._simulate_price(symbol, self.SIM_PRICES.get(symbol, 100.0))
                
            except Exception as e:
                print(f"Error fetching data for {symbol}: {e}")
                return self._simulate_price(symbol, self.SIM_PRICES.get(symbol, 100.0))

    def _simulate_price(self, symbol, base_price):
        import random
        # Add slight variation (-1% to +1%)
        variation = random.uniform(-0.01, 0.01)
        price = base_price * (1 + variation)
        return {"symbol": symbol, "price": price, "source": "simulated"}

    async def get_indicators(self, symbol: str):
        """
        Fetch RSI and SMA for a commodity/symbol.
        """
        SYMBOL_MAP = {
            "GC": "XAU/USD",
            "SI": "XAG/USD",
            "CL": "WTI/USD",
            "HG": "XCU/USD",
            "NG": "XNG/USD"
        }
        api_symbol = SYMBOL_MAP.get(symbol, symbol)

        if not self.API_KEY:
            return self._simulate_indicators(symbol)

        async with httpx.AsyncClient() as client:
            try:
                # TwelveData RSI
                rsi_res = await client.get(
                    f"{self.BASE_URL}/rsi",
                    params={"symbol": api_symbol, "interval": "1day", "time_period": 14, "apikey": self.API_KEY},
                    timeout=3.0
                )
                rsi_data = rsi_res.json()
                if "values" not in rsi_data or rsi_data.get("status") == "error":
                    print(f"RSI API Error/Limit for {symbol}: {rsi_data.get('message', 'No values')}")
                    return self._simulate_indicators(symbol)
                
                rsi_val = float(rsi_data["values"][0]["rsi"])

                # TwelveData SMA
                sma_res = await client.get(
                    f"{self.BASE_URL}/sma",
                    params={"symbol": api_symbol, "interval": "1day", "time_period": 20, "apikey": self.API_KEY},
                    timeout=3.0
                )
                sma_data = sma_res.json()
                sma_val = float(sma_data["values"][0]["sma"]) if "values" in sma_data and sma_data.get("status") != "error" else None

                return {
                    "rsi": rsi_val,
                    "sma": sma_val
                }
                
            except Exception as e:
                print(f"Error fetching indicators for {symbol}: {e}")
                return self._simulate_indicators(symbol)

    def _simulate_indicators(self, symbol):
        import random
        # Highly varied mockup for testing logic when API is limited
        rsi = random.uniform(25.0, 75.0)
        # Simulate SMA being slightly above or below price randomly
        sma_signal = random.choice(["Above SMA20", "Below SMA20", None])
        
        return {
            "rsi": rsi,
            "sma_sim_signal": sma_signal # Internal hint for analytics
        }

    def _simulate_history(self, symbol, days):
        import random
        # Base volatility factor per symbol for more interesting UI
        VOL_MAP = {
            "GC": 0.005,  # Low volatility (Gold)
            "SI": 0.015,  # Med
            "CL": 0.025,  # High (Oil)
            "HG": 0.012,
            "NG": 0.040   # Very High (Nat Gas)
        }
        v_factor = VOL_MAP.get(symbol, 0.02)
        
        base = self.SIM_PRICES.get(symbol, 100.0) # Use updated sim price as anchor
        prices = []
        # Calculate a start price that drifts to the current base price
        curr = base * (1 - (random.uniform(-0.1, 0.1) * (days/30)))
        
        for _ in range(days):
            curr = curr * (1 + random.uniform(-v_factor, v_factor))
            prices.append(curr)
            
        # Ensure the last price is close to the current SIM price for consistency
        prices[-1] = base * (1 + random.uniform(-0.005, 0.005))
        return prices

    async def get_historical_prices(self, symbol: str, days: int = 30):
        """
        Fetch historical daily closes for volatility calculation.
        """
        SYMBOL_MAP = {
            "GC": "XAU/USD",
            "SI": "XAG/USD",
            "CL": "WTI/USD",
            "HG": "XCU/USD",
            "NG": "XNG/USD"
        }
        api_symbol = SYMBOL_MAP.get(symbol, symbol)

        if not self.API_KEY:
            return self._simulate_history(symbol, days)

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.BASE_URL}/time_series",
                    params={
                        "symbol": api_symbol,
                        "interval": "1day",
                        "outputsize": days,
                        "apikey": self.API_KEY
                    },
                    timeout=5.0
                )
                data = response.json()
                if "values" in data:
                    return [float(v["close"]) for v in data["values"]]
                
                print(f"History API Error for {symbol}: {data.get('message')}")
                return self._simulate_history(symbol, days)
            except Exception as e:
                print(f"Error fetching history for {symbol}: {e}")
                return self._simulate_history(symbol, days)

    async def search_symbols(self, query: str):
        """
        Search for available symbols using TwelveData API.
        """
        if not self.API_KEY:
            # Mock search
             return [
                 {"symbol": "AAPL", "instrument_name": "Apple Inc", "exchange": "NASDAQ", "country": "United States"},
                 {"symbol": "TSLA", "instrument_name": "Tesla Inc", "exchange": "NASDAQ", "country": "United States"},
                 {"symbol": "EUR/USD", "instrument_name": "Euro / US Dollar", "exchange": "Forex", "country": "United States"}
             ]

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.BASE_URL}/symbol_search",
                    params={"symbol": query, "apikey": self.API_KEY}
                )
                data = response.json()
                if "data" in data:
                    return data["data"]
                return []
            except Exception as e:
                print(f"Error searching symbols: {e}")
                return []

data_engine = DataEngine()
