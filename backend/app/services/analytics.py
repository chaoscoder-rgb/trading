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
                    },
                    timeout=4.0
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
        
        # 1. News Sentiment (40% Weight, Scale 0-100)
        news = await self.fetch_news(symbol)
        sentiment = self.analyze_sentiment(news)
        news_score = sentiment['score']
        
        # 2. Technical Indicators (30% Weight, Scale 0-100)
        indicators = await data_engine.get_indicators(symbol)
        rsi = indicators.get('rsi', 50.0)
        sma = indicators.get('sma')
        
        # Map RSI to 0-100 (Inverted: Low RSI is Bullish/High Score)
        # 30 RSI -> 100 points, 70 RSI -> 0 points
        if rsi < 30: rsi_score = 100
        elif rsi > 70: rsi_score = 0
        else: rsi_score = 100 - (rsi - 30) * (100 / 40)
        
        ti_score = rsi_score
        ti_signals = [f"RSI is {rsi:.1f}"]
        
        # SMA Trend
        if sma:
            if current_price > sma:
                ti_score += 20
                ti_signals.append("Above SMA20 (Bullish)")
            else:
                ti_score -= 20
                ti_signals.append("Below SMA20 (Bearish)")
        elif "sma_sim_signal" in indicators:
            if indicators["sma_sim_signal"] == "Above SMA20":
                ti_score += 20
                ti_signals.append("Above SMA20 (Bullish)")
            elif indicators["sma_sim_signal"] == "Below SMA20":
                ti_score -= 20
                ti_signals.append("Below SMA20 (Bearish)")
        
        ti_score = max(0, min(100, ti_score))

        # 3. Polymarket (20% Weight, Scale 0-100)
        from app.services.polymarket import polymarket_service
        polls = await polymarket_service.get_related_markets(symbol)
        pm_score = polymarket_service.calculate_sentiment_score(polls)

        # 4. Macro Data (10% Weight, Scale 0-100)
        dxy = await fred_service.get_dollar_index()
        yield_10y = await fred_service.get_10y_yield()
        fed_rate = await fred_service.get_fed_funds_rate()

        macro_raw = 50
        macro_signals = []
        if dxy:
            if dxy < 100: macro_raw += 25; macro_signals.append("Weak Dollar")
            elif dxy > 105: macro_raw -= 25; macro_signals.append("Strong Dollar")
            
        if fed_rate:
            if fed_rate < 3.0: macro_raw += 25; macro_signals.append("Low Interest Rates")
            elif fed_rate > 5.0: macro_raw -= 25; macro_signals.append("High Interest Rates")

        if yield_10y and symbol in ["GC", "SI"]:
            if yield_10y < 3.5: macro_raw += 25; macro_signals.append("Falling Yields")
            elif yield_10y > 4.5: macro_raw -= 25; macro_signals.append("Rising Yields")
            
        macro_score = max(0, min(100, macro_raw))
        macro_status = ", ".join(macro_signals) if macro_signals else "Neutral"

        # 5. Weighted Consensus Calculation
        # Weights: News 40%, Tech 30%, Polymarket 20%, Macro 10%
        confidence = (news_score * 0.4) + (ti_score * 0.3) + (pm_score * 0.2) + (macro_score * 0.1)
        
        # Optional: Incorporate Smart Money as a minor bias (e.g., +/- 5 points)
        from app.services.insider import insider_service
        insider_tx = await insider_service.get_insider_transactions(symbol)
        congress_tx = await insider_service.get_congress_trading(symbol)
        ins_score, insider_status = insider_service.analyze_insider_sentiment(insider_tx)
        
        political_signal = "Neutral"
        if congress_tx:
            buys = [t for t in congress_tx[:5] if t.get('transactionType') == 'Purchase']
            sells = [t for t in congress_tx[:5] if t.get('transactionType') == 'Sale']
            if len(buys) > len(sells): political_signal = "Bullish Political Flow"
            elif len(sells) > len(buys): political_signal = "Bearish Political Flow"

        # 6. Determine Action
        if confidence >= 75: action = "Strong Buy"
        elif confidence >= 55: action = "Buy"
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
            "breakdown": {
                "news": round(news_score, 1),
                "technical": round(ti_score, 1),
                "polymarket": round(pm_score, 1),
                "macro": round(macro_score, 1)
            },
            "reason": f"{'Mixed' if abs(ti_score - 50) > 10 else 'Sentiment'} Analysis: {ti_signals[0] if ti_signals else ''}",
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

    async def get_historical_accuracy(self, symbol: str) -> dict:
        """
        Calculate accuracy rate for this symbol based on recommendation history.
        """
        from app.db import get_db
        async for db in get_db():
            try:
                rs = await db.execute(
                    "SELECT status FROM recommendation_history WHERE symbol = ? AND status != 'Pending'",
                    [symbol]
                )
                total = len(rs.rows)
                if total == 0:
                    return {"rate": 0, "total": 0, "status": "No history"}
                
                correct = sum(1 for row in rs.rows if row[0] == 'Correct')
                rate = (correct / total) * 100
                
                return {
                    "rate": round(rate, 1),
                    "total": total,
                    "status": "Active"
                }
            except Exception:
                return {"rate": 0, "total": 0, "status": "Error"}
            break
        return {"rate": 0, "total": 0, "status": "Unavailable"}

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

        # 3. Fetch Historical Accuracy (Self-Correction)
        accuracy = await self.get_historical_accuracy(symbol)
        rec["historical_accuracy"] = accuracy
            
        return rec

analytics_engine = AnalyticsEngine()
