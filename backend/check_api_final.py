import requests
import json

try:
    response = requests.get("http://localhost:8000/api/commodities")
    if response.status_code == 200:
        data = response.json()
        print("Final sorted list from API:")
        for idx, item in enumerate(data):
            print(f"{idx+1}. {item['symbol']} ({item['name']})")
    else:
        print(f"Error: {response.status_code}")
except Exception as e:
    print(f"Exception: {e}")
