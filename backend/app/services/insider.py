import httpx
from app.config import settings
from datetime import datetime, timedelta

class InsiderService:
    def __init__(self):
        self.api_key = settings.FINNHUB_API_KEY
        self.base_url = settings.FINNHUB_BASE_URL

    async def get_insider_transactions(self, symbol: str):
        """
        Fetch insider transactions (Form 4).
        """
        if not self.api_key:
            return []

        # Map commodities to ETFs
        search_symbol = self._map_to_etf(symbol)

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/stock/insider-transactions",
                    params={
                        "symbol": search_symbol,
                        "token": self.api_key
                    }
                )
                if response.status_code == 200:
                    data = response.json()
                    return data.get('data', [])
                return []
            except Exception as e:
                print(f"Error fetching insider transactions for {symbol}: {e}")
                return []

    async def get_congress_trading(self, symbol: str):
        """
        Fetch US Congress trading data.
        """
        if not self.api_key:
            return []

        search_symbol = self._map_to_etf(symbol)

        async with httpx.AsyncClient() as client:
            try:
                # Assuming Finnhub's congress trading endpoint
                response = await client.get(
                    f"{self.base_url}/stock/congressional-trading",
                    params={
                        "symbol": search_symbol,
                        "token": self.api_key
                    }
                )
                if response.status_code == 200:
                    return response.json()
                return []
            except Exception as e:
                print(f"Error fetching congress trading for {symbol}: {e}")
                return []

    def _map_to_etf(self, symbol: str):
        mapping = {
            'GC': 'GLD',
            'SI': 'SLV',
            'CL': 'USO',
            'NG': 'UNG',
            'HG': 'CPER'
        }
        return mapping.get(symbol, symbol)

    def analyze_insider_sentiment(self, transactions: list):
        """
        Calculate a net sentiment score from insider transactions.
        Returns: Score (-10 to +10) and summary text.
        """
        if not transactions:
            return 0, "No recent insider activity."

        net_shares = 0
        buy_count = 0
        sell_count = 0
        
        # Consider only last 90 days if possible, or just the list provided
        for tx in transactions[:20]: # Look at recent 20
            change = tx.get('change', 0)
            if change > 0:
                buy_count += 1
                net_shares += change
            elif change < 0:
                sell_count += 1
                net_shares += abs(change)

        score = 0
        if buy_count > sell_count:
            score = 7
            status = "Strong Insider Buying"
        elif sell_count > buy_count:
            score = -7
            status = "Net Insider Selling"
        else:
            status = "Mixed Insider Activity"

        return score, status

insider_service = InsiderService()
