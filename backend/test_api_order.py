import requests
import json

try:
    response = requests.get("http://localhost:8000/api/commodities")
    if response.status_code == 200:
        data = response.json()
        print("API Response order:")
        for item in data:
            # The API doesn't return the numeric ID usually, but it returns symbol.
            # Let's see what's in 'id' field in the JSON (it's often the symbol)
            print(f"- Symbol: {item['symbol']}, ID field in JSON: {item['id']}")
    else:
        print(f"Error: {response.status_code}")
except Exception as e:
    print(f"Exception: {e}")
