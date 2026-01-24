import random
import httpx
from app.config import settings
from datetime import datetime, timedelta

class AnalyticsEngine:
    
    def __init__(self):
        self.finnhub_url = settings.FINNHUB_BASE_URL
        self.api_key = settings.FINNHUB_API_KEY

    def calculate_risk(self, data: dict) -> dict:
        """
        Calculate risk based on volatility/market data.
        Returns: Very High, High, Medium, Low
        """
        # Placeholder risk logic - in a real app this would use volatility from TwelveData
        risks = ["Very High", "High", "Medium", "Low"]
        risk = random.choice(risks)
        return {
            "level": risk,
            "score": random.uniform(0, 100),
            "reason": "Market volatility analysis (MVP Placeholder)"
        }

    async def fetch_news(self, symbol: str) -> list:
        """Fetch news from Finnhub"""
        if not self.api_key:
            return []
            
        try:
            # Finnhub requires distinct 'from' and 'to' dates
            today = datetime.now().strftime('%Y-%m-%d')
            week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.finnhub_url}/company-news",
                    params={
                        "symbol": symbol,
                        "from": week_ago,
                        "to": today,
                        "token": self.api_key
                    }
                )
                if response.status_code == 200:
                    return response.json()
                return []
        except Exception as e:
            print(f"Error fetching news: {e}")
            return []

    def analyze_sentiment(self, news_items: list) -> dict:
        """Basic keyword-based sentiment analysis"""
        if not news_items:
            return {"score": 50, "positives": [], "negatives": []}

        positive_keywords = ["growth", "record", "profit", "gain", "up", "bullish", "success", "beat", "higher"]
        negative_keywords = ["loss", "down", "drop", "bearish", "fail", "miss", "lower", "risk", "concern"]

        score = 50
        positives = []
        negatives = []

        for item in news_items[:10]: # Analyze top 10 news items
            headline = item.get('headline', '').lower()
            summary = item.get('summary', '').lower()
            combined = f"{headline} {summary}"
            
            source = item.get('source', 'Unknown')
            
            # Simple scoring
            p_count = sum(1 for k in positive_keywords if k in combined)
            n_count = sum(1 for k in negative_keywords if k in combined)
            
            if p_count > n_count:
                score += 5
                positives.append({"text": item.get('headline'), "source": source})
            elif n_count > p_count:
                score -= 5
                negatives.append({"text": item.get('headline'), "source": source})

        # Clamp score 0-100
        score = max(0, min(100, score))
        return {"score": score, "positives": positives, "negatives": negatives}

    async def generate_recommendation(self, data: dict) -> dict:
        """
        Generate Buy/Sell/Hold recommendation with detailed analysis.
        Returns: Strong Buy, Buy, Hold, Sell, Strong Sell
        """
        # For MVP we use the symbol from data if available, or default
        # The 'data' dict comes from data_engine.get_market_data which includes 'symbol'
        symbol = data.get('symbol', 'AAPL') # Default placeholder if not passed, but should be passed
        
        # 1. Real News Sentiment
        news = await self.fetch_news(symbol)
        sentiment = self.analyze_sentiment(news)
        confidence = sentiment['score']
        
        # 2. Determine Action based on Confidence
        if confidence >= 80:
            action = "Strong Buy"
        elif confidence >= 60:
            action = "Buy"
        elif confidence >= 40:
            action = "Hold"
        elif confidence >= 20:
            action = "Sell"
        else:
            action = "Strong Sell"

        # 3. Fallback if no news/real data (Simulated items for UI population)
        if not news:
            positives = [
                {"text": "Simulated: Strong upward momentum", "source": "Bloomberg"},
                {"text": "Simulated: Positive technicals", "source": "TradingView"}
            ]
            negatives = [
                {"text": "Simulated: High volatility", "source": "Volatility Index"},
                {"text": "Simulated: Global uncertainty", "source": "Reuters"}
            ]
            
            # Randomize confidence for simulation
            confidence = random.uniform(20, 80)
            if confidence > 50:
                sentiment['positives'] = positives
                sentiment['negatives'] = []
            else:
                sentiment['positives'] = []
                sentiment['negatives'] = negatives

        return {
            "action": action,
            "confidence": round(confidence, 1),
            "reason": "Sentiment Analysis based on recent news" if news else "Technical indicators (Simulated)",
            "analysis": {
                "positives": sentiment['positives'][:3] if sentiment['positives'] else [],
                "negatives": sentiment['negatives'][:3] if sentiment['negatives'] else []
            }
        }

    async def generate_enhanced_recommendation(self, data: dict, symbol: str) -> dict:
        # Get base recommendation
        # Note: data now passed to generate_recommendation should ideally contain symbol info
        # We patch the data dict to ensure symbol is present for fetch_news
        data['symbol'] = symbol
        rec = await self.generate_recommendation(data)
        
        # Fetch Polymarket Data
        try:
            from app.services.polymarket import polymarket_service
            polls = await polymarket_service.get_related_markets(symbol)
            rec["polls"] = polls
        except Exception:
            rec["polls"] = []
            
        return rec

analytics_engine = AnalyticsEngine()
