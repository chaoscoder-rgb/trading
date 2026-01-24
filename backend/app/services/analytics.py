import random
import httpx
from app.config import settings
from datetime import datetime, timedelta

class AnalyticsEngine:
    
    def __init__(self):
        self.finnhub_url = settings.FINNHUB_BASE_URL
        self.api_key = settings.FINNHUB_API_KEY

    async def calculate_risk_v2(self, symbol: str) -> dict:
        """
        Calculate risk based on 30-day historical volatility.
        """
        from app.services.data_engine import data_engine
        prices = await data_engine.get_historical_prices(symbol, days=30)
        
        if len(prices) < 2:
            return {"level": "Medium", "volatility": 0.0, "reason": "Insufficient data"}

        # Calculate daily returns
        import math
        returns = []
        for i in range(len(prices)-1):
            # Using simple percentage returns
            ret = (prices[i] - prices[i+1]) / prices[i+1]
            returns.append(ret)
            
        # Standard Deviation
        mean = sum(returns) / len(returns)
        variance = sum((r - mean)**2 for r in returns) / len(returns)
        std_dev = math.sqrt(variance)
        
        # Daily volatility in %
        vol = std_dev * 100
        
        # Adjusted thresholds for more variety in typical market conditions
        if vol < 1.0: level = "Low"
        elif vol < 2.0: level = "Medium"
        else: level = "High"
        
        return {
            "level": level,
            "volatility": round(vol, 2),
            "reason": f"Historical 30-day volatility is {vol:.2f}%"
        }

    async def fetch_news(self, symbol: str) -> list:
        """Fetch news from Finnhub"""
        if not self.api_key:
            return []
            
        # Map commodity symbols to search terms for better results
        # Finnhub 'company-news' endpoint expects stock symbols. 
        # For commodities, we might need 'market-news' or just search by related ETF/Stock if free tier limits us.
        # Let's map to common ETFs or just try the symbol.
        search_symbol = symbol
        if symbol == 'SI': search_symbol = 'SLV' # Silver ETF
        elif symbol == 'GC': search_symbol = 'GLD' # Gold ETF
        elif symbol == 'CL': search_symbol = 'USO' # Oil ETF
        elif symbol == 'NG': search_symbol = 'UNG' # Natural Gas ETF
        elif symbol == 'HG': search_symbol = 'CPER' # Copper
            
        try:
            # Finnhub requires distinct 'from' and 'to' dates
            today = datetime.now().strftime('%Y-%m-%d')
            week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.finnhub_url}/company-news",
                    params={
                        "symbol": search_symbol,
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

        # Expanded keywords for commodities
        positive_keywords = [
            "growth", "record", "profit", "gain", "up", "bullish", "success", "beat", "higher", 
            "surge", "rally", "demand", "strong", "jump", "climb", "resilient", "outperform"
        ]
        negative_keywords = [
            "loss", "down", "drop", "bearish", "fail", "miss", "lower", "risk", "concern",
            "plunge", "fall", "weak", "oversupply", "recession", "slump", "uncertainty"
        ]

        score = 50
        positives = []
        negatives = []

        for item in news_items[:15]: # Analyze top 15 news items
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
        from app.services.data_engine import data_engine
        from app.services.fred import fred_service
        symbol = data.get('symbol', 'AAPL') 
        current_price = data.get('price', 0.0)
        
        # 1. Real News Sentiment (Base: 50, Range: 0-100)
        news = await self.fetch_news(symbol)
        sentiment = self.analyze_sentiment(news)
        news_score = sentiment['score']
        
        # 2. Technical Indicators Signal (Base: 0, Range: -30 to +30)
        indicators = await data_engine.get_indicators(symbol)
        rsi = indicators.get('rsi', 50.0)
        sma = indicators.get('sma')
        
        ti_score = 0
        ti_signals = []
        
        # RSI Logic
        if rsi < 35:
            ti_score += 20
            ti_signals.append(f"RSI is {rsi:.1f} (Oversold - Bullish)")
        elif rsi > 65:
            ti_score -= 20
            ti_signals.append(f"RSI is {rsi:.1f} (Overbought - Bearish)")
        else:
            ti_signals.append(f"RSI is {rsi:.1f} (Neutral)")
            
        # SMA Logic
        if sma:
            if current_price > sma:
                ti_score += 10
                ti_signals.append("Trend: Above SMA20 (Bullish)")
            else:
                ti_score -= 10
                ti_signals.append("Trend: Below SMA20 (Bearish)")
        elif "sma_sim_signal" in indicators:
            sig = indicators["sma_sim_signal"]
            if sig == "Above SMA20":
                ti_score += 10
                ti_signals.append("Trend: Above SMA20 (Bullish)")
            elif sig == "Below SMA20":
                ti_score -= 10
                ti_signals.append("Trend: Below SMA20 (Bearish)")

        # 3. Smart Money & Political Sentiment (Base: 0, Range: -15 to +15)
        from app.services.insider import insider_service
        insider_tx = await insider_service.get_insider_transactions(symbol)
        congress_tx = await insider_service.get_congress_trading(symbol)
        
        insider_score, insider_status = insider_service.analyze_insider_sentiment(insider_tx)
        
        # Political Signal (Congessional) - Simplified detection
        political_score = 0
        political_signal = "Neutral"
        if congress_tx:
            # Finnhub returns a list of trades
            recent_trades = congress_tx[:5]
            buys = [t for t in recent_trades if t.get('transactionType') == 'Purchase']
            sells = [t for t in recent_trades if t.get('transactionType') == 'Sale']
            if len(buys) > len(sells):
                political_score = 8
                political_signal = f"Bullish Political Flow ({len(buys)} trades)"
            elif len(sells) > len(buys):
                political_score = -8
                political_signal = f"Bearish Political Flow ({len(sells)} trades)"

        # 4. Macroeconomic Correlations (Base: 0, Range: -15 to +15)
        dxy = await fred_service.get_dollar_index()
        yield_10y = await fred_service.get_10y_yield()
        fed_rate = await fred_service.get_fed_funds_rate()

        macro_score = 0
        macro_signals = []
        
        # DXY Impact
        if dxy:
            if dxy > 105:
                macro_score -= 5
                macro_signals.append("Headwind: Strong Dollar")
            elif dxy < 100:
                macro_score += 5
                macro_signals.append("Tailwind: Weak Dollar")

        # Interest Rate Impact
        if fed_rate and fed_rate > 5.0:
            macro_score -= 5
            macro_signals.append("Headwind: High Interest Rates")
        
        # 10Y Yield Impact (Specific to Metals)
        if yield_10y and symbol in ["GC", "SI"]:
            if yield_10y > 4.0:
                macro_score -= 5
                macro_signals.append("Headwind: Rising Yields (Bearish for Metals)")
            elif yield_10y < 3.5:
                macro_score += 5
                macro_signals.append("Tailwind: Falling Yields (Bullish for Metals)")

        macro_status = " / ".join(macro_signals) if macro_signals else "Macro Neutral"

        # 5. Weighted Confidence (Dynamic Weights based on data availability)
        # Weights: News 35%, Technicals 30%, Macro 20%, Smart Money 15%
        confidence = news_score + ti_score + macro_score + insider_score + political_score
        confidence = max(0, min(100, confidence)) # Clamp
        
        # 6. Determine Action based on Confidence
        if confidence >= 80: action = "Strong Buy"
        elif confidence >= 60: action = "Buy"
        elif confidence >= 40: action = "Hold"
        elif confidence >= 25: action = "Sell"
        else: action = "Strong Sell"

        # 5. Fallback if no news OR no meaningful sentiment extracted
        has_meaningful_sentiment = len(sentiment['positives']) > 0 or len(sentiment['negatives']) > 0
        
        if not news or not has_meaningful_sentiment:
            positives = [
                {"text": f"Technical Outlook: {', '.join(ti_signals)}", "source": "System Indicator"}
            ]
            negatives = []
            
            if not has_meaningful_sentiment:
                 # If no news context, rely more on TI for simulation
                 pass 
            
            if confidence > 50:
                sentiment['positives'] = positives
                if not sentiment['negatives']: sentiment['negatives'] = []
            else:
                sentiment['negatives'] = positives # Reuse the TI signal as a data point
                if not sentiment['positives']: sentiment['positives'] = []

        return {
            "action": action,
            "confidence": round(confidence, 1),
            "reason": f"{'Mixed' if abs(ti_score) > 0 else 'Sentiment'} Analysis: {ti_signals[0] if ti_signals else ''}",
            "indicators": {
                "rsi": round(rsi, 1),
                "sma": round(sma, 2) if sma else None,
                "signals": ti_signals
            },
            "macro": {
                "dxy": round(dxy, 2) if dxy else None,
                "yield_10y": round(yield_10y, 2) if yield_10y else None,
                "fed_rate": round(fed_rate, 2) if fed_rate else None,
                "signal": macro_status
            },
            "unusual_flow": {
                "insider_status": insider_status,
                "political_status": political_signal,
                "insider_trades": insider_tx[:3],
                "political_trades": congress_tx[:3] if congress_tx else []
            },
            "analysis": {
                "positives": sentiment['positives'][:3] if sentiment['positives'] else [],
                "negatives": sentiment['negatives'][:3] if sentiment['negatives'] else []
            }
        }

    async def generate_enhanced_recommendation(self, data: dict, symbol: str) -> dict:
        # Get base recommendation
        data['symbol'] = symbol
        rec = await self.generate_recommendation(data)
        
        # 1. Fetch Real Risk based on Volatility
        risk_data = await self.calculate_risk_v2(symbol)
        rec["risk"] = risk_data
        
        # 2. Fetch Polymarket Data
        try:
            from app.services.polymarket import polymarket_service
            polls = await polymarket_service.get_related_markets(symbol)
            rec["polls"] = polls
        except Exception:
            rec["polls"] = []
            
        return rec

analytics_engine = AnalyticsEngine()
