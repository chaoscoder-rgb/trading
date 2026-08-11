// Hardcoded for production stability
// const API_URL = "https://trading-3t73.onrender.com";
const API_URL = import.meta.env.VITE_API_URL || "";

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

// ---- Stop-loss & alerts ----

export const fetchStopLossSettings = async () => {
    const response = await fetch(`${API_URL}/api/settings/stop-loss`);
    if (!response.ok) throw new Error("Failed to fetch stop-loss settings");
    return response.json();
};

export const saveStopLossSettings = async (settings) => {
    const response = await fetch(`${API_URL}/api/settings/stop-loss`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error("Failed to save stop-loss settings");
    return response.json();
};

export const setHoldingStopLoss = async (id, stopLossPct) => {
    const response = await fetch(`${API_URL}/api/holdings/${id}/stop-loss`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop_loss_pct: stopLossPct }),
    });
    if (!response.ok) throw new Error("Failed to set stop loss");
    return response.json();
};

export const fetchAlerts = async () => {
    const response = await fetch(`${API_URL}/api/alerts`);
    if (!response.ok) throw new Error("Failed to fetch alerts");
    return response.json();
};

export const markAlertsRead = async () => {
    const response = await fetch(`${API_URL}/api/alerts/mark-read`, { method: "POST" });
    if (!response.ok) throw new Error("Failed to mark alerts read");
    return response.json();
};

export const fetchStopLossHistory = async () => {
    const response = await fetch(`${API_URL}/api/stop-loss/history`);
    if (!response.ok) throw new Error("Failed to fetch stop-loss history");
    return response.json();
};

export const fetchSymbolSnapshot = async (symbol) => {
    const response = await fetch(`${API_URL}/api/symbols/${symbol}/snapshot`);
    if (!response.ok) throw new Error("Failed to fetch symbol snapshot");
    return response.json();
};

// ---- Market-wide screener ----

export const runScreener = async (params) => {
    const qs = new URLSearchParams();
    qs.set("universe", params.universe);
    if (params.minConfidence !== '' && params.minConfidence != null) qs.set("min_confidence", params.minConfidence);
    if (params.political) qs.set("political", "true");
    if (params.polymarket) qs.set("polymarket", "true");
    if (params.kalshi) qs.set("kalshi", "true");
    if (params.risk?.length) qs.set("risk", params.risk.join(","));
    if (params.actions?.length) qs.set("action", params.actions.join(","));
    const response = await fetch(`${API_URL}/api/screener?${qs}`);
    if (!response.ok) throw new Error("Screener query failed");
    return response.json();
};

export const fetchScreenerStatus = async () => {
    const response = await fetch(`${API_URL}/api/screener/status`);
    if (!response.ok) throw new Error("Failed to fetch screener status");
    return response.json();
};

export const refreshScreener = async (universe) => {
    const qs = universe ? `?universe=${universe}` : '';
    const response = await fetch(`${API_URL}/api/screener/refresh${qs}`, { method: "POST" });
    if (!response.ok) throw new Error("Failed to start screener refresh");
    return response.json();
};
