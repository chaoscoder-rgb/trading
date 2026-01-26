// Hardcoded for production stability
const API_URL = "https://trading-3t73.onrender.com";
// const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export const fetchCommodities = async () => {
    const response = await fetch(`${API_URL}/api/commodities`);
    if (!response.ok) {
        throw new Error("Failed to fetch commodities");
    }
    return response.json();
};

export const placeTrade = async (tradeData) => {
    const response = await fetch(`${API_URL}/api/trade`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(tradeData),
    });
    if (!response.ok) {
        throw new Error("Failed to place trade");
    }
    return response.json();
};

export const fetchHoldings = async () => {
    const response = await fetch(`${API_URL}/api/holdings`);
    if (!response.ok) throw new Error("Failed to fetch holdings");
    return response.json();
};

export const createHolding = async (holding) => {
    const response = await fetch(`${API_URL}/api/holdings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(holding),
    });
    if (!response.ok) throw new Error("Failed to create holding");
    return response.json();
};

export const updateHolding = async (id, holding) => {
    const response = await fetch(`${API_URL}/api/holdings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(holding),
    });
    if (!response.ok) throw new Error("Failed to update holding");
    return response.json();
};

export const deleteHolding = async (id) => {
    const response = await fetch(`${API_URL}/api/holdings/${id}`, {
        method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete holding");
    return response.json();
};

export const fetchHistory = async () => {
    const response = await fetch(`${API_URL}/api/history`);
    if (!response.ok) throw new Error("Failed to fetch history");
    return response.json();
};

export const searchCommodities = async (query) => {
    const response = await fetch(`${API_URL}/api/commodities/search?query=${query}`);
    if (!response.ok) throw new Error("Failed to search commodities");
    return response.json();
};

export const addCommodity = async (symbol, name) => {
    const response = await fetch(`${API_URL}/api/commodities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name }),
    });
    if (!response.ok) throw new Error("Failed to add commodity");
    return response.json();
};

export const deleteCommodity = async (symbol) => {
    const response = await fetch(`${API_URL}/api/commodities/${symbol}`, {
        method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete commodity");
    return response.json();
};

export const fetchCommodityHistory = async (symbol, days = 30) => {
    const response = await fetch(`${API_URL}/api/commodities/${symbol}/history?days=${days}`);
    if (!response.ok) throw new Error("Failed to fetch history");
    return response.json();
};
