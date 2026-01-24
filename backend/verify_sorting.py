import requests

symbol = "AAPL"
name = "Apple Inc."

try:
    # Add commodity
    print(f"Adding {symbol}...")
    resp = requests.post("http://localhost:8000/api/commodities", json={"symbol": symbol, "name": name})
    print(f"Add response: {resp.status_code} {resp.text}")
    
    # Check order
    print("Checking order...")
    resp = requests.get("http://localhost:8000/api/commodities")
    if resp.status_code == 200:
        data = resp.json()
        print(f"First item: {data[0]['symbol']} (should be {symbol})")
    else:
        print(f"Error fetching: {resp.status_code}")
except Exception as e:
    print(f"Exception: {e}")
