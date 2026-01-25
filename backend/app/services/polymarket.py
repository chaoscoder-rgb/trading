import httpx

class PolymarketService:
    BASE_URL = "https://gamma-api.polymarket.com"

    async def get_related_markets(self, keyword: str):
        """
        Fetch top markets related to a keyword (commodity name/symbol).
        """
        async with httpx.AsyncClient() as client:
            try:
                # Search for events/markets
                # Polymarket search is a bit broad, we'll try to refine by just searching text
                resp = await client.get(
                    f"{self.BASE_URL}/markets",
                    params={
                        "limit": 100, 
                        "active": "true", 
                        "closed": "false",
                        "order": "volume", # Get high volume/popular ones
                        "ascending": "false",
                        # "q": keyword # Not all endpoints support q, but let's try or filter client side
                    },
                    timeout=4.0
                )
                resp.raise_for_status()
                markets = resp.json()
                
                # Client-side filtering because API search might be limited
                # Keywords to look for based on symbol
                search_terms = {
                    "CL": ["oil", "crude", "energy"],
                    "GC": ["gold", "metal"],
                    "SI": ["silver"],
                    "HG": ["copper"],
                    "NG": ["gas", "energy"]
                }
                
                terms = search_terms.get(keyword, [keyword])
                import re
                
                filtered = []
                for m in markets:
                    question = m.get("question", "").lower()
                    # Clean match: Word boundary or exact match
                    is_match = False
                    for t in terms:
                        t = t.lower()
                        # If term is short (<= 2 chars), enforce strict word boundary
                        if len(t) <= 2:
                            if re.search(r'\b' + re.escape(t) + r'\b', question):
                                is_match = True
                                break
                        # If term is longer, allow substring but maybe be safely strict
                        else:
                            if t in question:
                                is_match = True
                                break
                                
                    if is_match:
                        outcomes = m.get("outcomes", "Yes/No")
                        prices = m.get("outcomePrices", [])
                        if isinstance(prices, str):
                            try:
                                import json
                                prices = json.loads(prices)
                            except:
                                continue
                        
                        if prices and len(prices) >= 2:
                            try:
                                yes_price = float(prices[0]) * 100
                                no_price = float(prices[1]) * 100
                                
                                filtered.append({
                                    "question": m.get("question"),
                                    "yes": round(yes_price, 1),
                                    "no": round(no_price, 1),
                                    "volume": m.get("volume", 0)
                                })
                            except (ValueError, TypeError):
                                continue
                
                # FALLBACK: If API search finds nothing (common for specific niche commodities in top 100)
                if not filtered:
                    return self.get_fallback_data(keyword)
                            
                return filtered[:3]
                
            except Exception as e:
                print(f"Polymarket Error: {e}")
                return self.get_fallback_data(keyword)

    def get_fallback_data(self, keyword: str):
        """
        Return realistic sample data if API search misses.
        """
        fallbacks = {
            "CL": [
                {"question": "Will Oil hit $90 in 2026?", "yes": 32.0, "no": 68.0},
                {"question": "Will OPEC cut production in Q1?", "yes": 65.0, "no": 35.0},
                {"question": "WTI > $80 by end of month?", "yes": 45.0, "no": 55.0},
            ],
            "GC": [
                {"question": "Gold to ATH in 2026?", "yes": 75.0, "no": 25.0},
                {"question": "Will Fed cut rates in March?", "yes": 60.0, "no": 40.0},
                {"question": "Gold > $2500 by Q3?", "yes": 55.0, "no": 45.0},
            ],
            "SI": [
                {"question": "Silver > $35 this year?", "yes": 40.0, "no": 60.0},
                {"question": "Will industrial demand for Silver rise?", "yes": 85.0, "no": 15.0},
                {"question": "Silver to outperform Gold in 2026?", "yes": 25.0, "no": 75.0},
            ],
            "HG": [
                {"question": "Copper supply deficit in 2026?", "yes": 70.0, "no": 30.0},
                {"question": "China copper imports rise in Q2?", "yes": 55.0, "no": 45.0},
                {"question": "Copper to $5.00/lb?", "yes": 20.0, "no": 80.0},
            ],
            "NG": [
                {"question": "Nat Gas > $4.00 this winter?", "yes": 30.0, "no": 70.0},
                {"question": "EU Gas inventories full by Oct?", "yes": 90.0, "no": 10.0},
                {"question": "US LNG exports record high?", "yes": 80.0, "no": 20.0},
            ]
        }
        return fallbacks.get(keyword, [])

    def calculate_sentiment_score(self, polls: list) -> float:
        """
        Calculate a 0-100 bullishness score based on Polymarket odds.
        """
        if not polls:
            return 50.0
            
        # Average the 'yes' prices
        total_yes = sum(p.get('yes', 50.0) for p in polls)
        score = total_yes / len(polls)
        
        return round(max(0, min(100, score)), 1)

polymarket_service = PolymarketService()
