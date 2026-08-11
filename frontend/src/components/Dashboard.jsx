import React, { useEffect, useState } from 'react';
import { fetchCommodities, placeTrade, fetchHoldings, createHolding, updateHolding, deleteHolding, fetchHistory, searchCommodities, addCommodity, deleteCommodity as deleteCommodityAPI, fetchCommodityHistory, fetchStopLossSettings, saveStopLossSettings, setHoldingStopLoss, fetchAlerts, markAlertsRead, fetchStopLossHistory, fetchSymbolSnapshot, runScreener, fetchScreenerStatus, refreshScreener } from '../api';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const Dashboard = () => {
    const [activeTab, setActiveTab] = useState('market'); // 'market' | 'holdings'

    // Market State
    const [commodities, setCommodities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCommodity, setSelectedCommodity] = useState(null);
    const [historyData, setHistoryData] = useState([]); // Chart data
    const [wk52, setWk52] = useState(null); // {high, low} — 52-week band for the chart

    // Decide whether the 52W lines can be drawn without wrecking the scale.
    // A line is drawn only if it sits within a tolerance of the visible data
    // range; otherwise its value is shown as a chip above the chart instead.
    const chartScale = React.useMemo(() => {
        const prices = historyData.map(h => h.price).filter(v => typeof v === 'number' && isFinite(v));
        if (!prices.length) return null;
        const dMin = Math.min(...prices), dMax = Math.max(...prices);
        const span = Math.max(dMax - dMin, dMax * 0.02); // guard for flat series
        const tol = Math.max(span * 0.75, dMax * 0.15);
        const showHigh = wk52 != null && wk52.high <= dMax + tol;
        const showLow = wk52 != null && wk52.low >= dMin - tol;
        return {
            showHigh, showLow,
            yMin: (showLow && wk52 ? Math.min(dMin, wk52.low) : dMin) * 0.995,
            yMax: (showHigh && wk52 ? Math.max(dMax, wk52.high) : dMax) * 1.005,
        };
    }, [historyData, wk52]);
    const [timeRange, setTimeRange] = useState('1M'); // Time range state

    const [tradeAmount, setTradeAmount] = useState(100);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [isSearching, setIsSearching] = useState(false);

    // Calendar-day ranges. 1D dropped (EOD data = a single point); 3Y/5Y
    // replaced by Max — the data source's free tier caps history at ~2 years,
    // so they rendered identical charts.
    const TIME_RANGES = {
        '1W': 7,
        '1M': 30,
        'YTD': Math.max(1, Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24))),
        '1Y': 365,
        'Max': 9999
    };

    // Company snapshot for the selected symbol
    const [snapshot, setSnapshot] = useState(null);
    const [loadingSnapshot, setLoadingSnapshot] = useState(false);
    useEffect(() => {
        if (!selectedCommodity) { setSnapshot(null); return; }
        let cancelled = false;
        setLoadingSnapshot(true);
        fetchSymbolSnapshot(selectedCommodity.symbol)
            .then(d => { if (!cancelled) setSnapshot(d); })
            .catch(() => { if (!cancelled) setSnapshot(null); })
            .finally(() => { if (!cancelled) setLoadingSnapshot(false); });
        return () => { cancelled = true; };
    }, [selectedCommodity?.symbol]);

    // Fetch History when commodity or timeRange selected
    useEffect(() => {
        if (selectedCommodity) {
            const days = TIME_RANGES[timeRange] || 30;
            fetchCommodityHistory(selectedCommodity.symbol, days)
                .then(data => {
                    // New shape: {history, week52_high, week52_low}; tolerate the old bare array
                    if (Array.isArray(data)) {
                        setHistoryData(data);
                        setWk52(null);
                    } else {
                        setHistoryData(data.history || []);
                        setWk52(data.week52_high != null && data.week52_low != null
                            ? { high: data.week52_high, low: data.week52_low } : null);
                    }
                })
                .catch(err => console.error("Failed to load history chart", err));
        }
    }, [selectedCommodity, timeRange]);

    // Sync selectedCommodity when commodities list updates
    useEffect(() => {
        if (selectedCommodity && commodities.length > 0) {
            const updated = commodities.find(c => c.symbol === selectedCommodity.symbol);
            if (updated && updated !== selectedCommodity) {
                setSelectedCommodity(updated);
            }
        }
    }, [commodities]);

    // Holdings State
    const [holdings, setHoldings] = useState([]);
    const [history, setHistory] = useState([]);
    const [loadingHoldings, setLoadingHoldings] = useState(false);
    const [editingHolding, setEditingHolding] = useState(null); // null or holding object

    // Screener state — combinable filters; universe = watchlist (live) or an index (precomputed)
    const [screener, setScreener] = useState({ universe: 'watchlist', minConfidence: '', minDividend: '', political: false, polymarket: false, kalshi: false, risk: [], actions: [] });
    const [showScreener, setShowScreener] = useState(false);
    const [screenerResults, setScreenerResults] = useState(null); // index-universe results
    const [screenerStatus, setScreenerStatus] = useState(null);
    const [screenerLoading, setScreenerLoading] = useState(false);
    const [openDropdown, setOpenDropdown] = useState(null); // 'risk' | 'actions' | null
    const screenerActive = screener.minConfidence !== '' || screener.minDividend !== '' || screener.political || screener.polymarket || screener.kalshi || screener.risk.length > 0 || screener.actions.length > 0;
    const indexMode = screener.universe !== 'watchlist';

    const RISK_OPTIONS = ['Low', 'Medium', 'High'];
    const ACTION_OPTIONS = ['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'];
    const toggleMulti = (field, value) => {
        setScreener(prev => ({
            ...prev,
            [field]: prev[field].includes(value) ? prev[field].filter(v => v !== value) : [...prev[field], value],
        }));
    };

    const MultiSelect = ({ id, label, options, selected }) => (
        <div className="relative">
            <button
                onClick={() => setOpenDropdown(openDropdown === id ? null : id)}
                className={`border rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-2 ${selected.length ? 'border-blue-400 bg-blue-50 text-blue-700' : 'bg-white text-gray-700'}`}
            >
                {label}{selected.length > 0 && <span className="bg-blue-600 text-white text-[10px] font-black rounded-full px-1.5">{selected.length}</span>}
                <span className="text-[9px]">▼</span>
            </button>
            {openDropdown === id && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-[75] min-w-[150px] py-1">
                    {options.map(opt => (
                        <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                            <input type="checkbox" className="w-4 h-4 accent-blue-600"
                                checked={selected.includes(opt)} onChange={() => toggleMulti(id, opt)} />
                            {opt}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );

    // Query precomputed index scores whenever filters change in index mode
    useEffect(() => {
        if (!indexMode) { setScreenerResults(null); return; }
        let cancelled = false;
        setScreenerLoading(true);
        Promise.all([runScreener(screener), fetchScreenerStatus()])
            .then(([res, status]) => { if (!cancelled) { setScreenerResults(res); setScreenerStatus(status); } })
            .catch(err => { console.error(err); if (!cancelled) setScreenerResults({ results: [], matched: 0 }); })
            .finally(() => { if (!cancelled) setScreenerLoading(false); });
        return () => { cancelled = true; };
    }, [screener.universe, screener.minConfidence, screener.minDividend, screener.political, screener.polymarket, screener.kalshi,
        JSON.stringify(screener.risk), JSON.stringify(screener.actions)]);

    const handleWatchFromScreener = async (row) => {
        try {
            await addCommodity(row.symbol, row.name);
            loadData();
        } catch (e) { alert("Failed to add to watchlist"); }
    };

    const handleScreenerRefresh = async () => {
        try {
            const r = await refreshScreener(screener.universe);
            alert(r.status === 'already_running'
                ? 'A scoring run is already in progress.'
                : 'Scoring run started. Dow 30 takes ~10 min; the full S&P 500 ~2 hours (free API rate limits). Results appear as they are scored.');
            fetchScreenerStatus().then(setScreenerStatus).catch(() => {});
        } catch (e) { alert("Failed to start scoring run"); }
    };

    const avgYes = (items, key) => {
        if (!items || items.length === 0) return null;
        const vals = items.map(m => parseFloat(m[key])).filter(v => !isNaN(v));
        if (vals.length === 0) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const matchesScreener = (item) => {
        const rec = item.recommendation || {};
        if (screener.minConfidence !== '' && !(parseFloat(rec.confidence) >= parseFloat(screener.minConfidence))) return false;
        if (screener.political && !(rec.unusual_flow?.political_status || '').includes('Bullish')) return false;
        if (screener.polymarket) {
            const yes = avgYes(rec.polls, 'yes');
            if (yes === null || yes <= 50) return false;
        }
        if (screener.kalshi) {
            const yes = avgYes(rec.kalshi, 'yes_price');
            if (yes === null || yes <= 50) return false;
        }
        if (screener.risk.length > 0 && !screener.risk.includes(item.risk?.level)) return false;
        if (screener.actions.length > 0 && !screener.actions.includes(rec.action)) return false;
        if (screener.minDividend !== '') {
            const dy = parseFloat(item.dividend_yield);
            if (isNaN(dy) || dy < parseFloat(screener.minDividend)) return false;
        }
        return true;
    };

    // Watchlist filtering applies only in watchlist mode; index mode has its own results panel
    const visibleCommodities = (screenerActive && screener.universe === 'watchlist')
        ? commodities.filter(matchesScreener) : commodities;

    // Stop-loss & alerts state
    const [slSettings, setSlSettings] = useState(null);
    const [showSlModal, setShowSlModal] = useState(false);
    const [slDraft, setSlDraft] = useState(null);
    const [slHistory, setSlHistory] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [showAlerts, setShowAlerts] = useState(false);
    const unreadCount = alerts.filter(a => !a.read).length;

    const loadAlerts = async () => {
        try { setAlerts(await fetchAlerts()); } catch (e) { console.error(e); }
    };

    // Poll alerts every 60s so stop-loss warnings surface without a reload
    useEffect(() => {
        loadAlerts();
        fetchStopLossSettings().then(setSlSettings).catch(console.error);
        const t = setInterval(loadAlerts, 60000);
        return () => clearInterval(t);
    }, []);

    const openAlerts = async () => {
        const next = !showAlerts;
        setShowAlerts(next);
        if (next && unreadCount > 0) {
            try { await markAlertsRead(); } catch (e) { console.error(e); }
            setAlerts(prev => prev.map(a => ({ ...a, read: true })));
        }
    };

    const saveSlSettingsDraft = async () => {
        try {
            const saved = await saveStopLossSettings({
                enabled: slDraft.enabled,
                default_pct: parseFloat(slDraft.default_pct),
                auto_execute: slDraft.auto_execute,
                pre_warning_ratio: parseFloat(slDraft.pre_warning_ratio),
            });
            setSlSettings(saved);
            setShowSlModal(false);
            loadHoldings();
        } catch (e) {
            alert("Failed to save stop-loss settings");
        }
    };

    // Initial Load
    useEffect(() => {
        loadData();
    }, []);

    // Fetch Market Data
    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchCommodities();
            if (!Array.isArray(data)) throw new Error("Invalid data format received");
            setCommodities(data);
        } catch (err) {
            console.error("Load Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Fetch Holdings Data
    const loadHoldings = async () => {
        setLoadingHoldings(true);
        try {
            const [data, hist, slh] = await Promise.all([fetchHoldings(), fetchHistory(), fetchStopLossHistory().catch(() => [])]);
            setHoldings(data);
            setHistory(hist);
            setSlHistory(slh);
        } catch (err) {
            console.error("Fetch Holdings Error:", err);
        } finally {
            setLoadingHoldings(false);
        }
    };

    // Tab Switching Logic
    useEffect(() => {
        if (activeTab === 'holdings') {
            loadHoldings();
        } else if (activeTab === 'market' && commodities.length === 0) {
            loadData();
        }
    }, [activeTab]);


    // --- Market Handler ---
    const [tradeModalOpen, setTradeModalOpen] = useState(false);
    const [tradeConfig, setTradeConfig] = useState({ action: 'BUY', quantity: 1, price: 0 });

    const openTradeModal = (action) => {
        if (!selectedCommodity) return;
        setTradeConfig({
            action,
            quantity: 1,
            price: parseFloat(selectedCommodity.price).toFixed(2)
        });
        setTradeModalOpen(true);
    };

    const executeTrade = async () => {
        try {
            await placeTrade({
                symbol: selectedCommodity.symbol,
                action: tradeConfig.action,
                amount: parseFloat(tradeConfig.quantity),
                price: parseFloat(tradeConfig.price)
            });
            alert(`${tradeConfig.action} order placed for ${selectedCommodity.symbol} @ $${tradeConfig.price}`);
            setTradeModalOpen(false);
            loadHoldings();
        } catch (error) {
            alert("Trade failed");
        }
    };

    // --- Holdings Handlers ---
    const handleAddDummyHolding = async () => {
        const dummy = {
            symbol: "CL",
            quantity: 10,
            avg_price: 75.50
        };
        await createHolding(dummy);
        loadHoldings();
    };

    const handleDeleteHolding = async (id) => {
        if (!confirm("Are you sure?")) return;
        await deleteHolding(id);
        loadHoldings();
    };

    const handleSaveHolding = async () => {
        if (!editingHolding) return;
        try {
            if (editingHolding.id) {
                await updateHolding(editingHolding.id, editingHolding);
                await setHoldingStopLoss(editingHolding.id, editingHolding.stop_loss_pct ?? null);
            } else {
                await createHolding(editingHolding);
            }
            setEditingHolding(null);
            loadHoldings();
        } catch (e) {
            alert("Failed to save holding");
        }
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        setIsSearching(true);
        try {
            const results = await searchCommodities(searchQuery);
            setSearchResults(Array.isArray(results) ? results : []);
        } catch (err) {
            console.error(err);
        } finally {
            setIsSearching(false);
        }
    };

    const handleAddCommodity = async (symbol, name) => {
        try {
            await addCommodity(symbol, name);
            setShowSearchModal(false);
            setSearchQuery('');
            setSearchResults([]);
            loadData(); // Reload commodities
        } catch (err) {
            alert("Failed to add commodity");
        }
    };

    const handleDeleteCommodity = async (e, symbol) => {
        e.stopPropagation();
        if (!confirm(`Remove ${symbol} from watchlist?`)) return;
        try {
            await deleteCommodityAPI(symbol);
            loadData();
        } catch (err) {
            alert("Failed to remove commodity");
        }
    };

    const handleSaveInline = async () => {
        if (!editingHolding) return;
        try {
            await updateHolding(editingHolding.id, editingHolding);
            await setHoldingStopLoss(editingHolding.id, editingHolding.stop_loss_pct ?? null);
            setEditingHolding(null);
            loadHoldings();
        } catch (err) {
            alert("Failed to update holding: " + err.message);
        }
    };

    if (loading) return <div className="p-10 text-center text-xl">Loading Market Data...</div>;
    if (error) return <div className="p-10 text-center text-red-600 font-bold">Error: {error}</div>;

    return (
        <div className="container mx-auto p-4">
            <header className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">TradeVision</h1>
                <div className="flex items-center gap-3">
                {/* Alert Center */}
                <div className="relative">
                    <button
                        onClick={openAlerts}
                        className="relative p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                        title="Alert Center"
                    >
                        <span className="text-xl">🔔</span>
                        {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                                {unreadCount}
                            </span>
                        )}
                    </button>
                    {showAlerts && (
                        <div className="absolute right-0 top-full mt-2 w-96 max-h-[420px] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-2xl z-[80]">
                            <div className="p-3 border-b border-gray-100 font-bold text-sm text-gray-700 flex justify-between items-center">
                                <span>Alert Center</span>
                                <button onClick={() => setShowAlerts(false)} className="text-gray-400 hover:text-black">✕</button>
                            </div>
                            {alerts.length === 0 ? (
                                <div className="p-6 text-center text-sm text-gray-400 italic">No alerts yet. Stop-loss warnings and triggers will appear here.</div>
                            ) : (
                                alerts.map(a => (
                                    <div key={a.id} className={`p-3 border-b border-gray-50 text-xs ${a.type === 'trigger' ? 'bg-red-50/50' : a.type === 'warning' ? 'bg-yellow-50/50' : ''}`}>
                                        <div className="flex justify-between items-center mb-1">
                                            <span className={`font-black uppercase text-[10px] ${a.type === 'trigger' ? 'text-red-600' : a.type === 'warning' ? 'text-yellow-600' : 'text-gray-500'}`}>
                                                {a.type === 'trigger' ? '⛔ Stop Triggered' : a.type === 'warning' ? '⚠️ Warning' : 'Info'} · {a.symbol}
                                            </span>
                                            <span className="text-[9px] text-gray-400">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
                                        </div>
                                        <div className="text-gray-700">{a.message}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
                <div className="flex bg-gray-200 rounded-lg p-1">
                    <button
                        onClick={() => setActiveTab('market')}
                        className={`px-4 py-2 rounded-md font-medium transition-colors ${activeTab === 'market' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                        Market Analysis
                    </button>
                    <button
                        onClick={() => setActiveTab('holdings')}
                        className={`px-4 py-2 rounded-md font-medium transition-colors ${activeTab === 'holdings' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                        My Holdings
                    </button>
                </div>
                </div>
            </header>

            {/* Search Modal */}
            {showSearchModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg min-h-[400px] max-h-[85vh] flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold">Add Symbol</h3>
                            <button onClick={() => setShowSearchModal(false)} className="text-gray-500 hover:text-black">✕</button>
                        </div>
                        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
                            <input
                                type="text"
                                className="flex-1 border rounded-lg px-4 py-2 uppercase"
                                placeholder="Search symbol (e.g. AAPL, BTC)..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold">Search</button>
                        </form>

                        <div className="flex-1 overflow-y-auto">
                            {isSearching ? <div className="text-center p-4">Searching...</div> : (
                                <div className="space-y-2">
                                    {searchResults.map((res, idx) => (
                                        <div key={idx} className="flex justify-between items-center p-3 hover:bg-gray-50 border rounded-lg">
                                            <div>
                                                <div className="font-bold">{res.symbol}</div>
                                                <div className="text-sm text-gray-500">{res.instrument_name || res.description}</div>
                                            </div>
                                            <button
                                                onClick={() => handleAddCommodity(res.symbol, res.instrument_name || res.description)}
                                                className="text-blue-600 font-bold hover:bg-blue-50 px-3 py-1 rounded"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    ))}
                                    {searchResults.length === 0 && searchQuery && !isSearching && (
                                        <div className="text-center text-gray-500 mt-4">No results found</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Sub-header for Market Tab */}
            {activeTab === 'market' && (
                <div className="mb-4">
                    <div className="flex justify-between items-center">
                        <button
                            onClick={() => setShowScreener(!showScreener)}
                            className={`px-4 py-2 rounded-lg font-bold text-sm shadow transition flex items-center gap-2
                                ${screenerActive ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                        >
                            🔍 Screener
                            {screenerActive && (
                                <span className="bg-white/25 px-2 py-0.5 rounded text-xs">
                                    {visibleCommodities.length}/{commodities.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setShowSearchModal(true)}
                            className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm shadow hover:bg-gray-700 transition"
                        >
                            + Add Symbol
                        </button>
                    </div>

                    {showScreener && (
                        <div className="mt-3 bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-3">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-500 uppercase">Universe</span>
                                <select
                                    className="border rounded-lg px-3 py-1.5 text-sm font-medium bg-white"
                                    value={screener.universe}
                                    onChange={(e) => setScreener({ ...screener, universe: e.target.value })}
                                >
                                    <option value="watchlist">My Watchlist (live)</option>
                                    <option value="sp500">S&P 500</option>
                                    <option value="nasdaq100">Nasdaq-100</option>
                                    <option value="dow30">Dow Jones 30</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-500 uppercase">AI Confidence ≥</span>
                                <input
                                    type="number" min="0" max="100" placeholder="e.g. 60"
                                    className="border rounded-lg px-3 py-1.5 w-24 text-sm font-mono"
                                    value={screener.minConfidence}
                                    onChange={(e) => setScreener({ ...screener, minConfidence: e.target.value })}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-500 uppercase">Min Dividend</span>
                                <input
                                    type="number" min="0" max="25" step="0.1" placeholder="e.g. 2"
                                    className="border rounded-lg px-3 py-1.5 w-20 text-sm font-mono"
                                    value={screener.minDividend}
                                    onChange={(e) => setScreener({ ...screener, minDividend: e.target.value })}
                                />
                                <span className="text-xs text-gray-400 font-bold">%</span>
                            </div>
                            <MultiSelect id="risk" label="⚠️ Risk" options={RISK_OPTIONS} selected={screener.risk} />
                            <MultiSelect id="actions" label="🎯 Recommendation" options={ACTION_OPTIONS} selected={screener.actions} />
                            {[
                                ['political', '🏛️ Political Flow: Bullish'],
                                ['polymarket', '📊 Polymarket: In favor'],
                                ['kalshi', '📈 Kalshi: In favor'],
                            ].map(([key, label]) => (
                                <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                        type="checkbox" className="w-4 h-4 accent-blue-600"
                                        checked={screener[key]}
                                        onChange={(e) => setScreener({ ...screener, [key]: e.target.checked })}
                                    />
                                    <span className="text-sm font-medium text-gray-700">{label}</span>
                                </label>
                            ))}
                            {(screenerActive || indexMode) && (
                                <button
                                    onClick={() => { setScreener({ universe: 'watchlist', minConfidence: '', minDividend: '', political: false, polymarket: false, kalshi: false, risk: [], actions: [] }); setOpenDropdown(null); }}
                                    className="ml-auto text-xs font-bold text-red-500 hover:text-red-700 uppercase"
                                >
                                    ✕ Reset
                                </button>
                            )}
                            <div className="w-full text-[10px] text-gray-400">
                                "In favor" = average yes-probability across related prediction markets &gt; 50%.
                                {indexMode
                                    ? ' Index scores are precomputed nightly (free API rate limits prevent live scoring of ~500 symbols).'
                                    : ' Watchlist filters use live data.'}
                            </div>
                        </div>
                    )}

                    {/* Index-universe results */}
                    {showScreener && indexMode && (
                        <div className="mt-3 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center flex-wrap gap-2">
                                <div className="text-sm font-bold text-gray-700">
                                    {screenerLoading ? 'Screening…' :
                                        screenerResults ? `${screenerResults.matched ?? 0} match${(screenerResults.matched ?? 0) !== 1 ? 'es' : ''} of ${screenerResults.universe_size ?? '—'} constituents` : ''}
                                </div>
                                <div className="flex items-center gap-3">
                                    {screenerStatus?.running ? (
                                        <span className="text-[10px] font-bold text-blue-600 animate-pulse uppercase">
                                            Scoring in progress… {screenerStatus.scored}/{screenerStatus.total}
                                        </span>
                                    ) : screenerResults?.results?.[0]?.updated_at ? (
                                        <span className="text-[10px] text-gray-400 uppercase">
                                            Scores as of {new Date(screenerResults.results[0].updated_at + 'Z').toLocaleString()}
                                        </span>
                                    ) : null}
                                    <button onClick={handleScreenerRefresh}
                                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase border border-blue-200 rounded px-2 py-1">
                                        ↻ Rescore now
                                    </button>
                                </div>
                            </div>
                            <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-50">
                                {!screenerLoading && screenerResults?.results?.length === 0 && (
                                    <div className="p-6 text-center text-sm text-gray-400">
                                        {screenerStatus?.scored > 0 || screenerStatus?.running
                                            ? 'No constituents match the current filters.'
                                            : 'No precomputed scores yet — hit "Rescore now" to run the first batch (or wait for the 2am nightly run).'}
                                    </div>
                                )}
                                {screenerResults?.results?.map(row => (
                                    <div key={row.symbol} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50">
                                        <div className="w-16 font-black text-gray-800">{row.symbol}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-gray-700 truncate">{row.name}</div>
                                            <div className="text-[9px] text-gray-400 uppercase">{row.sector || ''}</div>
                                        </div>
                                        <div className="text-right font-mono text-sm text-gray-700 w-24">
                                            ${(row.price || 0).toFixed(2)}
                                            <div className={`text-[10px] font-bold ${row.change_percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {row.change_percent >= 0 ? '+' : ''}{(row.change_percent || 0).toFixed(2)}%
                                            </div>
                                            {row.dividend_yield != null && (
                                                <div className="text-[9px] text-purple-600 font-bold" title="Dividend yield">
                                                    ⏵ {row.dividend_yield.toFixed(2)}% div
                                                </div>
                                            )}
                                        </div>
                                        <div className="w-24 text-center">
                                            <div className="text-sm font-black text-gray-800">{(row.confidence || 0).toFixed(0)}</div>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${(row.action || '').includes('Buy') ? 'bg-green-100 text-green-700' :
                                                (row.action || '').includes('Sell') ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {row.action}
                                            </span>
                                        </div>
                                        <div className="w-16 text-center">
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${row.risk_level === 'High' ? 'bg-red-100 text-red-700' :
                                                row.risk_level === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                                                row.risk_level === 'Low' ? 'bg-green-100 text-green-700' : 'bg-gray-50 text-gray-400'}`}
                                                title={row.volatility != null ? `30-day volatility ${row.volatility}%` : ''}>
                                                {row.risk_level || '—'}
                                            </span>
                                        </div>
                                        <div className="flex gap-1 w-20 justify-center">
                                            {(row.political_status || '').includes('Bullish') && <span title="Bullish political flow">🏛️</span>}
                                            {row.pm_favor === 1 && <span title="Polymarket in favor">📊</span>}
                                            {row.kalshi_favor === 1 && <span title="Kalshi in favor">📈</span>}
                                        </div>
                                        <button
                                            onClick={() => handleWatchFromScreener(row)}
                                            disabled={commodities.some(c => c.symbol === row.symbol)}
                                            className={`text-xs font-bold px-3 py-1.5 rounded-lg ${commodities.some(c => c.symbol === row.symbol)
                                                ? 'bg-gray-100 text-gray-400 cursor-default'
                                                : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                                        >
                                            {commodities.some(c => c.symbol === row.symbol) ? 'Watching' : '+ Watch'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MARKET TAB */}
            {activeTab === 'market' && (
                <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-200px)] min-h-[600px]">
                    {/* LEFT: Master List */}
                    <div className="lg:w-[350px] flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar shrink-0">
                        {screenerActive && !indexMode && visibleCommodities.length === 0 && (
                            <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">
                                No symbols match the current filters.
                            </div>
                        )}
                        {visibleCommodities.map((item) => (
                            <div
                                key={item.symbol}
                                className={`border rounded-xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer bg-white relative overflow-hidden group shrink-0
                                    ${selectedCommodity?.symbol === item.symbol ? 'ring-2 ring-blue-500 border-transparent shadow-md' : 'border-gray-200 hover:border-blue-200'}`}
                                onClick={() => setSelectedCommodity(item)}
                            >
                                <button
                                    onClick={(e) => handleDeleteCommodity(e, item.symbol)}
                                    className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Remove from watchlist"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </button>

                                <div className="flex justify-between items-center mb-2">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-xl font-bold text-gray-800">{item.symbol}</h2>
                                        <div className={`w-2 h-2 rounded-full ${item.recommendation.action.includes('Buy') ? 'bg-green-500' :
                                            item.recommendation.action.includes('Sell') ? 'bg-red-500' : 'bg-gray-400'}`}></div>
                                    </div>
                                    <div className="text-lg font-mono font-medium">${parseFloat(item.price || 0).toFixed(2)}</div>
                                </div>

                                <div className="flex justify-between items-center mb-3">
                                    <span className="text-xs text-gray-500 font-medium truncate max-w-[120px]">{item.name}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${item.recommendation.action.includes('Buy') ? 'bg-green-100 text-green-700' :
                                        item.recommendation.action.includes('Sell') ? 'bg-red-100 text-red-700' :
                                            'bg-gray-100 text-gray-700'
                                        }`}>
                                        {item.recommendation.action}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-center border-t border-gray-50 pt-3">
                                    <div className="bg-blue-50/50 rounded p-1.5 flex flex-col justify-center">
                                        <span className="text-[8px] font-bold text-blue-400 uppercase">RSI</span>
                                        <span className="text-xs font-mono font-bold leading-none">{item.recommendation.indicators?.rsi || '-'}</span>
                                    </div>
                                    <div className="bg-purple-50/50 rounded p-1.5 flex flex-col justify-center">
                                        <span className="text-[8px] font-bold text-purple-400 uppercase">Trend</span>
                                        <span className="text-[10px] font-bold leading-none truncate italic">
                                            {item.recommendation.indicators?.signals?.some(s => s.includes('Above SMA')) ? 'Bullish' :
                                                item.recommendation.indicators?.signals?.some(s => s.includes('Below SMA')) ? 'Bearish' : 'Neutral'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* RIGHT: Detail Viewer */}
                    <div className="flex-1 bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
                        {selectedCommodity ? (
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar relative">
                                <button
                                    onClick={() => setSelectedCommodity(null)}
                                    className="absolute top-6 right-6 text-gray-300 hover:text-red-500 p-2 rounded-full hover:bg-gray-100 transition-colors z-10"
                                    title="Close details"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>

                                <div className="flex flex-col gap-8">
                                    {/* Header Section */}
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b pb-6">
                                        <div>
                                            <div className="flex items-center gap-3 mb-1">
                                                <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">{selectedCommodity.symbol}</h2>
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider
                                                    ${selectedCommodity.risk.level === 'Low' ? 'bg-green-100 text-green-700' :
                                                        selectedCommodity.risk.level === 'Medium' ? 'bg-yellow-102 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                                    {selectedCommodity.risk.level} Risk
                                                </span>
                                            </div>
                                            <p className="text-gray-500 font-medium text-lg">{selectedCommodity.name}</p>
                                        </div>
                                        <div className="text-right mt-4 md:mt-0">
                                            <div className="text-4xl font-mono font-bold text-gray-900">${parseFloat(selectedCommodity.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                            {selectedCommodity.source !== 'Live' && <div className="text-[9px] text-gray-400 text-right mt-1">* Hover "SIMULATED" for details</div>}
                                            <div className="flex items-center justify-end gap-2 mt-1 relative group">
                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded cursor-help ${selectedCommodity.source === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                                    {selectedCommodity.source || 'Simulated'}
                                                </span>
                                                {selectedCommodity.source !== 'Live' && (
                                                    <div className="absolute right-0 top-full mt-2 w-max max-w-[250px] bg-gray-900/95 backdrop-blur-sm text-white text-[10px] p-3 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-all z-[100] pointer-events-none border border-gray-700">
                                                        <div className="font-bold mb-1 text-gray-400 uppercase tracking-wider text-[9px]">Simulation Reason</div>
                                                        {selectedCommodity.message || 'Data source is simulated due to API unavailability.'}
                                                    </div>
                                                )}
                                                <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Price</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Price Chart */}
                                    <div className="flex justify-between items-center gap-2 mb-2 flex-wrap">
                                        {wk52 ? (
                                            <div className="flex gap-2 items-center">
                                                <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-green-50 text-green-700 border border-green-100">
                                                    ▲ 52W High ${wk52.high.toLocaleString()}
                                                </span>
                                                <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-red-50 text-red-600 border border-red-100">
                                                    ▼ 52W Low ${wk52.low.toLocaleString()}
                                                </span>
                                            </div>
                                        ) : <div />}
                                        <div className="flex gap-1">
                                        {Object.keys(TIME_RANGES).map(range => (
                                            <button
                                                key={range}
                                                onClick={() => setTimeRange(range)}
                                                className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${timeRange === range
                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {range}
                                            </button>
                                        ))}
                                        </div>
                                    </div>
                                    <div className="h-64 w-full mb-6">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={historyData}>
                                                <defs>
                                                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1} />
                                                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <XAxis
                                                    dataKey="date"
                                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                                    minTickGap={45}
                                                    tickFormatter={(val) => {
                                                        if (!val) return '';
                                                        const date = new Date(val);
                                                        // 1D/1W: show Day Name (Mon)
                                                        if (['1D', '1W'].includes(timeRange)) {
                                                            return date.toLocaleDateString('en-US', { weekday: 'short' });
                                                        }
                                                        // 1M: show Date (Jan 25)
                                                        else if (timeRange === '1M') {
                                                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                                        }
                                                        // YTD: months within the current year
                                                        else if (timeRange === 'YTD') {
                                                            return date.toLocaleDateString('en-US', { month: 'short' });
                                                        }
                                                        // 1Y+: show Month + Year (Jan '26) so long ranges stay unambiguous
                                                        else {
                                                            return `${date.toLocaleDateString('en-US', { month: 'short' })} '${String(date.getFullYear()).slice(2)}`;
                                                        }
                                                    }}
                                                />
                                                <YAxis
                                                    // Domain stretches only for 52W lines that are close enough
                                                    // to the data to stay presentable; far-away extremes are
                                                    // shown as chips above the chart instead.
                                                    domain={[
                                                        (dataMin) => (chartScale ? chartScale.yMin : dataMin * 0.995),
                                                        (dataMax) => (chartScale ? chartScale.yMax : dataMax * 1.005),
                                                    ]}
                                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                                                    width={40}
                                                />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    labelStyle={{ display: 'none' }}
                                                    formatter={(value) => [`$${value.toFixed(2)}`, 'Price']}
                                                />
                                                {wk52 && chartScale?.showHigh && (
                                                    <ReferenceLine
                                                        y={wk52.high}
                                                        stroke="#16a34a"
                                                        strokeDasharray="6 4"
                                                        strokeWidth={1.5}
                                                        label={{ value: `52W High $${wk52.high.toLocaleString()}`, position: 'insideTopRight', fontSize: 10, fill: '#16a34a', fontWeight: 700 }}
                                                    />
                                                )}
                                                {wk52 && chartScale?.showLow && (
                                                    <ReferenceLine
                                                        y={wk52.low}
                                                        stroke="#dc2626"
                                                        strokeDasharray="6 4"
                                                        strokeWidth={1.5}
                                                        label={{ value: `52W Low $${wk52.low.toLocaleString()}`, position: 'insideBottomRight', fontSize: 10, fill: '#dc2626', fontWeight: 700 }}
                                                    />
                                                )}
                                                <Area
                                                    type="monotone"
                                                    dataKey="price"
                                                    stroke="#2563eb"
                                                    strokeWidth={2}
                                                    fillOpacity={1}
                                                    fill="url(#colorPrice)"
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>

                                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                                        {/* Left Col: Recommendation & Trade */}
                                        <div className="xl:col-span-1 border-r border-gray-100 pr-0 xl:pr-8 flex flex-col gap-6">
                                            <div>
                                                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recommendation Signal</div>
                                                <div className={`text-3xl font-black mb-4 ${selectedCommodity.recommendation.action.includes('Buy') ? 'text-green-600' :
                                                    selectedCommodity.recommendation.action.includes('Sell') ? 'text-red-600' : 'text-gray-500'}`}>
                                                    {selectedCommodity.recommendation.action}
                                                </div>

                                                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                                                    <div className="flex justify-between items-center mb-3">
                                                        <span className="text-sm font-bold text-gray-500 uppercase">AI Confidence</span>
                                                        <span className="text-lg font-bold text-gray-900">{selectedCommodity.recommendation.confidence}%</span>
                                                    </div>
                                                    <div className="h-3 bg-gray-200 rounded-full overflow-hidden mb-2">
                                                        <div
                                                            className={`h-full transition-all duration-700 rounded-full ${selectedCommodity.recommendation.confidence > 70 ? 'bg-green-500 shadowing-lg' :
                                                                selectedCommodity.recommendation.confidence > 40 ? 'bg-yellow-500 shadow-md' : 'bg-red-500'}`}
                                                            style={{ width: `${selectedCommodity.recommendation.confidence}%` }}
                                                        />
                                                    </div>
                                                    <div className="text-[10px] italic text-gray-400">{selectedCommodity.recommendation.reason}</div>

                                                    {selectedCommodity.recommendation.breakdown && (
                                                        <div className="mt-4 pt-4 border-t border-gray-100">
                                                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 text-center">Consensus Breakdown</div>
                                                            <div className="grid grid-cols-4 gap-2 text-center">
                                                                <div className="flex flex-col">
                                                                    <span className="text-[9px] font-bold text-blue-500">News</span>
                                                                    <span className="text-xs font-black text-gray-700">{Math.round(selectedCommodity.recommendation.breakdown.news)}</span>
                                                                </div>
                                                                <div className="flex flex-col border-l border-gray-100">
                                                                    <span className="text-[9px] font-bold text-purple-500">Tech</span>
                                                                    <span className="text-xs font-black text-gray-700">{Math.round(selectedCommodity.recommendation.breakdown.technical)}</span>
                                                                </div>
                                                                <div className="flex flex-col border-l border-gray-100">
                                                                    <span className="text-[9px] font-bold text-orange-500">Polls</span>
                                                                    <span className="text-xs font-black text-gray-700">{Math.round(selectedCommodity.recommendation.breakdown.polymarket)}</span>
                                                                </div>
                                                                <div className="flex flex-col border-l border-gray-100">
                                                                    <span className="text-[9px] font-bold text-green-500">Macro</span>
                                                                    <span className="text-xs font-black text-gray-700">{Math.round(selectedCommodity.recommendation.breakdown.macro)}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase mb-1">Model Performance</span>
                                                    <div className="flex items-center gap-2">
                                                        {selectedCommodity.recommendation.historical_accuracy?.total > 0 ? (
                                                            <>
                                                                <span className={`text-sm font-bold ${selectedCommodity.recommendation.historical_accuracy.rate >= 50 ? 'text-green-600' : 'text-orange-600'}`}>
                                                                    {selectedCommodity.recommendation.historical_accuracy.rate}% Accuracy
                                                                </span>
                                                                <span className="text-[9px] text-gray-400">({selectedCommodity.recommendation.historical_accuracy.total} verified)</span>
                                                            </>
                                                        ) : (
                                                            <span className="text-xs font-medium text-gray-400 italic">Insufficient History</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col border-l border-gray-100 pl-3">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase mb-1">Volatility</span>
                                                    <span className="text-base font-bold text-red-500">{selectedCommodity.recommendation.risk?.volatility || 0}%</span>
                                                </div>
                                                {selectedCommodity.recommendation.macro && (
                                                    <div className="flex flex-col border-l pl-3 gap-1">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase">Macro Bias</span>
                                                        <span className={`text-[11px] font-bold ${selectedCommodity.recommendation.macro.signal.includes('Tailwind') ? 'text-green-500' : 'text-red-500'}`}>
                                                            {selectedCommodity.recommendation.macro.signal.split('/')[0]}
                                                        </span>
                                                        <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1 border-t border-gray-50 pt-1">
                                                            <span className="text-[9px] font-bold text-gray-400">DXY: <span className="text-gray-600 font-mono">{selectedCommodity.recommendation.macro.dxy}</span></span>
                                                            <span className="text-[9px] font-bold text-gray-400">10Y: <span className="text-gray-600 font-mono">{selectedCommodity.recommendation.macro.yield_10y}%</span></span>
                                                            <span className="text-[9px] font-bold text-gray-400">IR: <span className="text-gray-600 font-mono">{selectedCommodity.recommendation.macro.fed_rate}%</span></span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Portfolio Position */}
                                            {(() => {
                                                const myHolding = holdings.find(h => h.symbol === selectedCommodity.symbol);
                                                if (myHolding) {
                                                    const diff = selectedCommodity.price - myHolding.avg_price;
                                                    const diffPercent = (diff / myHolding.avg_price) * 100;
                                                    const isPositive = diff >= 0;
                                                    return (
                                                        <div className="bg-blue-600 rounded-2xl p-5 text-white shadow-xl shadow-blue-100">
                                                            <div className="flex justify-between items-start mb-4">
                                                                <h4 className="text-xs font-bold uppercase tracking-widest text-blue-200">Portfolio Status</h4>
                                                                <div className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Active Position</div>
                                                            </div>
                                                            <div className="flex justify-between items-end mb-2">
                                                                <span className="text-2xl font-bold">Qty: {myHolding.quantity}</span>
                                                                <span className="text-2xl font-black">{isPositive ? '+' : ''}{diffPercent.toFixed(2)}%</span>
                                                            </div>
                                                            <div className="text-xs text-blue-200 font-medium">Average Price: ${myHolding.avg_price.toFixed(2)}</div>
                                                        </div>
                                                    );
                                                }
                                                return (
                                                    <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl p-5 text-center flex flex-col items-center justify-center gap-2">
                                                        <span className="text-gray-400 text-xl opacity-50">📁</span>
                                                        <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">No active position</span>
                                                    </div>
                                                );
                                            })()}

                                            <div className="flex gap-3 mt-auto pt-4">
                                                <button
                                                    onClick={() => openTradeModal('BUY')}
                                                    className="flex-1 bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl font-black shadow-lg shadow-green-100 transition-all uppercase tracking-widest"
                                                >
                                                    BUY
                                                </button>
                                                <button
                                                    onClick={() => openTradeModal('SELL')}
                                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-black shadow-lg shadow-red-100 transition-all uppercase tracking-widest"
                                                >
                                                    SELL
                                                </button>
                                            </div>
                                        </div>

                                        {/* Center Col: Signals & News */}
                                        <div className="xl:col-span-2 flex flex-col gap-6">
                                            {/* Indicators Summary */}
                                            {selectedCommodity.recommendation.indicators?.signals && (
                                                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Live Technical Signals</h3>
                                                    <div className="flex flex-wrap gap-2">
                                                        {selectedCommodity.recommendation.indicators.signals.map((sig, i) => (
                                                            <span key={i} className="bg-gray-50 border border-gray-100 px-3 py-1.5 rounded-lg text-xs font-bold text-gray-700 flex items-center gap-2">
                                                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></span>
                                                                {sig}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Company Snapshot: profile, fundamentals, categorized news */}
                                            <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                                <div className="flex justify-between items-center mb-5">
                                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                        <span className="text-lg">🏢</span> Company Snapshot
                                                        {snapshot?.is_proxy && <span className="normal-case font-medium text-gray-300 tracking-normal">via {snapshot.lookup_symbol} ETF</span>}
                                                    </h3>
                                                    {snapshot?.profile?.weburl && (
                                                        <a href={snapshot.profile.weburl} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-500 hover:underline uppercase">Website ↗</a>
                                                    )}
                                                </div>

                                                {loadingSnapshot ? (
                                                    <div className="text-sm text-gray-400 italic text-center py-6 animate-pulse">Loading company info…</div>
                                                ) : !snapshot || !snapshot.available ? (
                                                    <div className="text-xs text-gray-400 italic text-center py-4">
                                                        Company data unavailable — set FINNHUB_API_KEY on the server to enable this section.
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-5">
                                                        {/* Profile line */}
                                                        {snapshot.profile && (
                                                            <div className="flex items-center gap-3 flex-wrap">
                                                                {snapshot.profile.logo && <img src={snapshot.profile.logo} alt="" className="w-8 h-8 rounded" />}
                                                                <div>
                                                                    <div className="font-bold text-gray-900">{snapshot.profile.name}</div>
                                                                    <div className="text-[11px] text-gray-500">
                                                                        {[snapshot.profile.industry, snapshot.profile.exchange,
                                                                          snapshot.profile.market_cap ? `Mkt cap $${(snapshot.profile.market_cap / 1000).toFixed(1)}B` : null]
                                                                            .filter(Boolean).join(' · ')}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Key metrics */}
                                                        {snapshot.metrics && (
                                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                                                {[
                                                                    ['P/E (TTM)', snapshot.metrics.pe, v => v.toFixed(1)],
                                                                    ['EPS (TTM)', snapshot.metrics.eps, v => `$${v.toFixed(2)}`],
                                                                    ['52W High', snapshot.metrics.week52_high, v => `$${v.toFixed(2)}`],
                                                                    ['52W Low', snapshot.metrics.week52_low, v => `$${v.toFixed(2)}`],
                                                                    ['Div Yield', snapshot.metrics.dividend_yield, v => `${v.toFixed(2)}%`],
                                                                ].map(([label, val, fmt]) => (
                                                                    <div key={label} className="bg-gray-50 rounded-xl p-2.5 text-center border border-gray-100">
                                                                        <div className="text-[9px] font-bold text-gray-400 uppercase">{label}</div>
                                                                        <div className="text-sm font-black text-gray-800 font-mono">
                                                                            {(val ?? null) !== null ? fmt(val) : '—'}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Categorized news */}
                                                        {[
                                                            ['earnings', '📊 Earnings & Financials', 'text-blue-700 bg-blue-50 border-blue-100'],
                                                            ['leadership', '👔 Leadership & Corporate', 'text-purple-700 bg-purple-50 border-purple-100'],
                                                            ['general', '📰 Other News', 'text-gray-700 bg-gray-50 border-gray-100'],
                                                        ].map(([bucket, title, colors]) => (
                                                            snapshot.news[bucket]?.length > 0 && (
                                                                <div key={bucket} className={`rounded-xl border p-4 ${colors.split(' ').slice(1).join(' ')}`}>
                                                                    <div className={`text-[10px] font-black uppercase tracking-widest mb-2 ${colors.split(' ')[0]}`}>{title}</div>
                                                                    <ul className="space-y-2">
                                                                        {snapshot.news[bucket].slice(0, 4).map((n, i) => (
                                                                            <li key={i} className="text-xs">
                                                                                <a href={n.url} target="_blank" rel="noreferrer" className="font-bold text-gray-800 hover:text-blue-600 hover:underline leading-snug">
                                                                                    {n.headline}
                                                                                </a>
                                                                                <div className="text-[9px] text-gray-400 uppercase mt-0.5">{[n.source, n.date].filter(Boolean).join(' · ')}</div>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )
                                                        ))}
                                                        {!snapshot.news.earnings.length && !snapshot.news.leadership.length && !snapshot.news.general.length && (
                                                            <div className="text-xs text-gray-400 italic text-center py-2">No news in the last 14 days.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="bg-green-50/50 rounded-2xl p-6 border border-green-100">
                                                    <h3 className="font-bold text-green-800 mb-4 flex items-center gap-2 uppercase text-xs tracking-widest">
                                                        <span className="bg-green-100 rounded p-1.5">👍</span> Bullish Factors
                                                    </h3>
                                                    <ul className="space-y-4">
                                                        {selectedCommodity.recommendation.analysis?.positives?.map((p, i) => (
                                                            <li key={i} className="text-sm text-green-900 group">
                                                                <div className="font-bold mb-1 leading-snug group-hover:text-green-700 transition-colors">"{p.text}"</div>
                                                                <div className="text-[10px] text-green-600 font-bold uppercase tracking-tighter opacity-70">— Source: {p.source}</div>
                                                            </li>
                                                        ))}
                                                        {(!selectedCommodity.recommendation.analysis?.positives || selectedCommodity.recommendation.analysis.positives.length === 0) && (
                                                            <div className="text-xs text-green-600 italic">No significant bullish indicators detected.</div>
                                                        )}
                                                    </ul>
                                                </div>

                                                <div className="bg-red-50/50 rounded-2xl p-6 border border-red-100">
                                                    <h3 className="font-bold text-red-800 mb-4 flex items-center gap-2 uppercase text-xs tracking-widest">
                                                        <span className="bg-red-100 rounded p-1.5">👎</span> Bearish Factors
                                                    </h3>
                                                    <ul className="space-y-4">
                                                        {selectedCommodity.recommendation.analysis?.negatives?.map((n, i) => (
                                                            <li key={i} className="text-sm text-red-900 group">
                                                                <div className="font-bold mb-1 leading-snug group-hover:text-red-700 transition-colors">"{n.text}"</div>
                                                                <div className="text-[10px] text-red-600 font-bold uppercase tracking-tighter opacity-70">— Source: {n.source}</div>
                                                            </li>
                                                        ))}
                                                        {(!selectedCommodity.recommendation.analysis?.negatives || selectedCommodity.recommendation.analysis.negatives.length === 0) && (
                                                            <div className="text-xs text-red-600 italic">No significant bearish indicators detected.</div>
                                                        )}
                                                    </ul>
                                                </div>
                                            </div>

                                            {/* Global Macro Climate */}
                                            {selectedCommodity.recommendation.macro && (
                                                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                                        <span className="text-lg">🌍</span> Global Macro Climate
                                                    </h3>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                        <div className="flex flex-col gap-1 border-r border-gray-50 pr-4">
                                                            <span className="text-[10px] font-bold text-gray-400 uppercase">US Dollar Index</span>
                                                            <div className="text-2xl font-black text-gray-900">{selectedCommodity.recommendation.macro.dxy}</div>
                                                            <div className="text-[10px] text-gray-500 font-medium">USD Strength Indicator</div>
                                                        </div>
                                                        <div className="flex flex-col gap-1 border-r border-gray-50 pr-4">
                                                            <span className="text-[10px] font-bold text-gray-400 uppercase">10Y Treasury Yield</span>
                                                            <div className="text-2xl font-black text-blue-600">{selectedCommodity.recommendation.macro.yield_10y}%</div>
                                                            <div className="text-[10px] text-gray-500 font-medium">Risk-Free Market Baseline</div>
                                                        </div>
                                                        <div className="flex flex-col gap-1">
                                                            <span className="text-[10px] font-bold text-gray-400 uppercase">Fed Funds Rate</span>
                                                            <div className="text-2xl font-black text-purple-600">{selectedCommodity.recommendation.macro.fed_rate}%</div>
                                                            <div className="text-[10px] text-gray-500 font-medium">Liquidity Benchmark</div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-4 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs font-bold text-center text-gray-600 italic">
                                                        "{selectedCommodity.recommendation.macro.signal}"
                                                    </div>
                                                </div>
                                            )}

                                            {/* Political Flow (STOCK Act disclosures via kadoa open dataset) */}
                                            {selectedCommodity.recommendation.unusual_flow && (
                                                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                                    <div className="flex justify-between items-center mb-5">
                                                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                            <span className="text-lg">🏛️</span> Political Flow
                                                        </h3>
                                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${selectedCommodity.recommendation.unusual_flow.political_status.includes('Bullish') ? 'bg-blue-100 text-blue-700' :
                                                            selectedCommodity.recommendation.unusual_flow.political_status.includes('Bearish') ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                                            {selectedCommodity.recommendation.unusual_flow.political_status}
                                                        </span>
                                                    </div>
                                                    <div className="space-y-2">
                                                        {selectedCommodity.recommendation.unusual_flow.political_trades?.length > 0 ? (
                                                            selectedCommodity.recommendation.unusual_flow.political_trades.map((tx, idx) => (
                                                                <div key={idx} className="flex justify-between items-center text-[11px] border-b border-gray-50 pb-2 gap-2">
                                                                    <div className="min-w-0">
                                                                        <div className="font-bold text-gray-800 truncate">{tx.representative || 'Official'}</div>
                                                                        <div className="text-[9px] text-gray-400 uppercase">{[tx.branch, tx.date].filter(Boolean).join(' · ')}</div>
                                                                    </div>
                                                                    <div className="text-right shrink-0">
                                                                        <div className={`font-bold ${tx.transactionType === 'Purchase' ? 'text-green-600' : 'text-red-600'}`}>
                                                                            {tx.transactionType}
                                                                        </div>
                                                                        {tx.amount && <div className="text-[9px] text-gray-400">{tx.amount}</div>}
                                                                    </div>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <div className="text-[10px] text-gray-400 italic">No disclosed congressional/executive trades for this asset.</div>
                                                        )}
                                                    </div>
                                                    <div className="mt-3 text-[9px] text-gray-300 text-right">Source: STOCK Act filings (kadoa open dataset)</div>
                                                </div>
                                            )}

                                            {/* Prediction Markets (Polymarket) */}
                                            {/* Prediction Markets (Polymarket) */}
                                            <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                                    <span className="text-lg">📊</span> Polymarket Insights
                                                </h3>
                                                {selectedCommodity.recommendation.polls?.length > 0 ? (
                                                    <div className="space-y-5">
                                                        {selectedCommodity.recommendation.polls.map((poll, i) => (
                                                            <div key={i} className="flex flex-col gap-2">
                                                                <div className="text-sm font-bold text-gray-800">{poll.question}</div>
                                                                <div className="flex items-center gap-3">
                                                                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden flex">
                                                                        <div className="h-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.3)]" style={{ width: `${poll.yes}%` }} />
                                                                        <div className="h-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]" style={{ width: `${poll.no}%` }} />
                                                                    </div>
                                                                    <div className="flex gap-2 text-[10px] font-black uppercase">
                                                                        <span className="text-green-600">Yes {poll.yes}%</span>
                                                                        <span className="text-red-500">No {poll.no}%</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-gray-400 italic text-center py-4">No relevant info from Polymarket.</p>
                                                )}
                                            </div>

                                            {/* Kalshi Predictions */}
                                            {/* Kalshi Predictions */}
                                            <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm mt-6">
                                                <div className="flex justify-between items-center mb-5">
                                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                        <span className="text-lg">📈</span> Kalshi Insights
                                                    </h3>
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 uppercase">Regulated</span>
                                                </div>

                                                {selectedCommodity.recommendation.kalshi && selectedCommodity.recommendation.kalshi.length > 0 ? (
                                                    <div className="space-y-5">
                                                        {selectedCommodity.recommendation.kalshi.map((m, i) => (
                                                            <div key={i} className="flex flex-col gap-2">
                                                                <div className="text-sm font-bold text-gray-800">{m.question}</div>
                                                                <div className="flex items-center gap-3">
                                                                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden flex">
                                                                        <div className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.3)]" style={{ width: `${m.yes_price}%` }} />
                                                                        <div className="h-full bg-gray-300" style={{ width: `${m.no_price}%` }} />
                                                                    </div>
                                                                    <div className="flex gap-2 text-[10px] font-black uppercase">
                                                                        <span className="text-indigo-600">Yes {m.yes_price}%</span>
                                                                        <span className="text-gray-500">No {m.no_price}%</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-sm text-gray-400 italic text-center py-4">No relevant info from Kalshi.</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-60 p-12 text-center animate-pulse">
                                <div className="text-6xl mb-6">🔭</div>
                                <h3 className="text-2xl font-bold mb-2">Market Overview Selective</h3>
                                <p className="text-sm font-medium max-w-xs">Select any commodity from the left panel to display deep AI analysis and market insights.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* HOLDINGS TAB */}
            {activeTab === 'holdings' && (
                <div className="space-y-8">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text">Portfolio Performance</h2>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setSlDraft({ ...(slSettings || { enabled: true, default_pct: 10, auto_execute: false, pre_warning_ratio: 0.8 }) }); setShowSlModal(true); }}
                                    className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-700 transition-colors"
                                    title="Stop-loss configuration"
                                >
                                    🛡️ Stop Loss {slSettings ? `(${slSettings.default_pct}%${slSettings.enabled ? '' : ' · off'})` : ''}
                                </button>
                                <button
                                    onClick={() => setEditingHolding({ symbol: '', quantity: 0, avg_price: 0 })}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
                                >
                                    + Add Entry
                                </button>
                            </div>
                        </div>

                        {loadingHoldings ? (
                            <div className="p-8 text-center text-gray-500">Loading holdings...</div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                    <tr>
                                        <th className="px-6 py-4 font-semibold">Symbol</th>
                                        <th className="px-6 py-4 font-semibold text-right">Qty</th>
                                        <th className="px-6 py-4 font-semibold text-right">Avg Price</th>
                                        <th className="px-6 py-4 font-semibold text-right">Current Price</th>
                                        <th className="px-6 py-4 font-semibold text-right">Total Price</th>
                                        <th className="px-6 py-4 font-semibold text-right">Date and Time</th>
                                        <th className="px-6 py-4 font-semibold text-right">P&L</th>
                                        <th className="px-6 py-4 font-semibold text-right">Stop Loss</th>
                                        <th className="px-6 py-4 font-semibold text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {holdings.map((h) => {
                                        const isEditing = editingHolding && editingHolding.id === h.id;
                                        const currentPrice = commodities.find(c => c.symbol === h.symbol)?.price || 0;
                                        const displayQty = isEditing ? editingHolding.quantity : h.quantity;
                                        const displayAvg = isEditing ? editingHolding.avg_price : h.avg_price;

                                        const pnl = (currentPrice - displayAvg) * displayQty;
                                        const pnlClass = pnl >= 0 ? 'text-green-600' : 'text-red-600';
                                        const lastUpdated = h.last_updated ? new Date(h.last_updated).toLocaleString() : '-';

                                        return (
                                            <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4 font-bold text-gray-800">{h.symbol}</td>

                                                {/* Edit Qty */}
                                                <td className="px-6 py-4 text-right font-mono">
                                                    {isEditing ? (
                                                        <input
                                                            type="number"
                                                            className="border rounded px-2 py-1 w-24 text-right"
                                                            value={editingHolding.quantity}
                                                            onChange={(e) => setEditingHolding({ ...editingHolding, quantity: parseFloat(e.target.value) || 0 })}
                                                        />
                                                    ) : h.quantity}
                                                </td>

                                                {/* Edit Avg Price */}
                                                <td className="px-6 py-4 text-right font-mono">
                                                    {isEditing ? (
                                                        <div className="flex justify-end items-center gap-1">
                                                            <span>$</span>
                                                            <input
                                                                type="number"
                                                                className="border rounded px-2 py-1 w-24 text-right"
                                                                value={editingHolding.avg_price}
                                                                onChange={(e) => setEditingHolding({ ...editingHolding, avg_price: parseFloat(e.target.value) || 0 })}
                                                            />
                                                        </div>
                                                    ) : `$${h.avg_price.toFixed(2)}`}
                                                </td>

                                                <td className="px-6 py-4 text-right font-mono text-gray-500">${currentPrice.toFixed(2)}</td>
                                                <td className="px-6 py-4 text-right font-mono font-bold text-gray-800">${(displayQty * currentPrice).toFixed(2)}</td>
                                                <td className="px-6 py-4 text-right text-xs text-gray-500">{lastUpdated}</td>
                                                <td className={`px-6 py-4 text-right font-bold font-mono ${pnlClass}`}>
                                                    {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}
                                                </td>

                                                {/* Stop loss: effective %, distance-to-stop, inline override */}
                                                <td className="px-6 py-4 text-right">
                                                    {isEditing ? (
                                                        <div className="flex justify-end items-center gap-1">
                                                            <input
                                                                type="number" min="1" max="50" step="0.5"
                                                                placeholder={slSettings ? `${slSettings.default_pct}` : '10'}
                                                                className="border rounded px-2 py-1 w-16 text-right"
                                                                value={editingHolding.stop_loss_pct ?? ''}
                                                                onChange={(e) => setEditingHolding({ ...editingHolding, stop_loss_pct: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                                            />
                                                            <span className="text-xs text-gray-400">%</span>
                                                        </div>
                                                    ) : (() => {
                                                        const stopPct = h.effective_stop_pct || slSettings?.default_pct || 10;
                                                        const pnlPct = displayAvg > 0 && currentPrice > 0 ? ((currentPrice - displayAvg) / displayAvg) * 100 : 0;
                                                        const distance = pnlPct + stopPct; // % of adverse move left before trigger
                                                        const triggered = h.stop_state === 'triggered' || distance <= 0;
                                                        const near = distance <= stopPct * 0.2;   // inside pre-warning band
                                                        return (
                                                            <div className="flex flex-col items-end gap-0.5">
                                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${triggered ? 'bg-red-600 text-white' : near ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
                                                                    {stopPct}% {h.stop_loss_pct ? '(custom)' : ''}
                                                                </span>
                                                                <span className={`text-[10px] font-mono ${triggered ? 'text-red-600 font-bold' : near ? 'text-yellow-600' : 'text-gray-400'}`}>
                                                                    {triggered ? 'TRIGGERED' : currentPrice > 0 ? `${distance.toFixed(1)}% to stop` : '—'}
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="px-6 py-4 text-right flex justify-end gap-2">
                                                    {isEditing ? (
                                                        <>
                                                            <button
                                                                onClick={handleSaveInline}
                                                                className="text-white bg-green-500 hover:bg-green-600 px-3 py-1 rounded text-sm font-bold"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingHolding(null)}
                                                                className="text-gray-600 hover:text-gray-800 px-2 text-sm font-medium"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedCommodity(commodities.find(c => c.symbol === h.symbol) || { symbol: h.symbol, price: 0 });
                                                                    openTradeModal('SELL');
                                                                }}
                                                                className="text-white bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm font-bold shadow-sm"
                                                            >
                                                                Sell
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingHolding(h)}
                                                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                                                            >
                                                                Edit
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteHolding(h.id)}
                                                                className="text-red-400 hover:text-red-600 text-sm font-medium ml-2"
                                                            >
                                                                Remove
                                                            </button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {holdings.length === 0 && (
                                        <tr>
                                            <td colSpan="9" className="px-6 py-12 text-center text-gray-400">
                                                No holdings found. Add a dummy entry to start.
                                            </td>
                                        </tr>
                                    )}
                                    {holdings.length > 0 && (
                                        <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                                            <td colSpan="4" className="px-6 py-4 text-right text-gray-700">TOTAL</td>
                                            <td className="px-6 py-4 text-right font-mono text-gray-800">
                                                ${holdings.reduce((sum, h) => {
                                                    const price = commodities.find(c => c.symbol === h.symbol)?.price || 0;
                                                    return sum + (h.quantity * price);
                                                }, 0).toFixed(2)}
                                            </td>
                                            <td></td>
                                            <td className={`px-6 py-4 text-right font-mono ${holdings.reduce((sum, h) => {
                                                const price = commodities.find(c => c.symbol === h.symbol)?.price || 0;
                                                return sum + ((price - h.avg_price) * h.quantity);
                                            }, 0) >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                {holdings.reduce((sum, h) => {
                                                    const price = commodities.find(c => c.symbol === h.symbol)?.price || 0;
                                                    return sum + ((price - h.avg_price) * h.quantity);
                                                }, 0) >= 0 ? '+' : ''}
                                                {holdings.reduce((sum, h) => {
                                                    const price = commodities.find(c => c.symbol === h.symbol)?.price || 0;
                                                    return sum + ((price - h.avg_price) * h.quantity);
                                                }, 0).toFixed(2)}
                                            </td>
                                            <td></td>
                                            <td></td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Stop Loss Trigger History */}
                    {slHistory.length > 0 && (
                        <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-xl font-bold text-gray-800">🛡️ Stop Loss Trigger History</h2>
                                <span className="text-xs text-gray-400">{slHistory.length} trigger{slHistory.length !== 1 ? 's' : ''}</span>
                            </div>
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                    <tr>
                                        <th className="px-6 py-3 font-semibold">Symbol</th>
                                        <th className="px-6 py-3 font-semibold text-right">Trigger Price</th>
                                        <th className="px-6 py-3 font-semibold text-right">Loss %</th>
                                        <th className="px-6 py-3 font-semibold">Action</th>
                                        <th className="px-6 py-3 font-semibold text-right">When</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {slHistory.map(t => (
                                        <tr key={t.trigger_id} className="hover:bg-gray-50">
                                            <td className="px-6 py-3 font-bold text-gray-800">{t.symbol}</td>
                                            <td className="px-6 py-3 text-right font-mono">${(t.trigger_price || 0).toFixed(2)}</td>
                                            <td className="px-6 py-3 text-right font-mono text-red-600 font-bold">{(t.loss_percentage || 0).toFixed(2)}%</td>
                                            <td className="px-6 py-3">
                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${t.action_taken === 'AUTO_SELL' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                    {t.action_taken === 'AUTO_SELL' ? 'Auto-sold' : 'Alert only'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-right text-xs text-gray-500">{t.triggered_at ? new Date(t.triggered_at).toLocaleString() : '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}



                    <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-6 border-b border-gray-100">
                            <h2 className="text-xl font-bold text-gray-800">Shares Sold History</h2>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                                    <tr>
                                        <th className="px-6 py-4 font-semibold">Symbol</th>
                                        <th className="px-6 py-4 font-semibold text-right">Qty Sold</th>
                                        <th className="px-6 py-4 font-semibold text-right">Sale Price</th>
                                        <th className="px-6 py-4 font-semibold text-right">Total Sale</th>
                                        <th className="px-6 py-4 font-semibold">Date</th>
                                        <th className="px-6 py-4 font-semibold text-right">Purchase Price</th>
                                        <th className="px-6 py-4 font-semibold text-right">Total Purchase</th>
                                        <th className="px-6 py-4 font-semibold text-right">P/L ($)</th>
                                        <th className="px-6 py-4 font-semibold text-right">P/L (%)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {history.filter(tx => tx.type === 'SELL').map((tx) => {
                                        const totalSale = tx.amount * tx.price;
                                        const purchasePrice = tx.cost_basis || 0;
                                        const totalPurchase = tx.amount * purchasePrice;
                                        const profitLoss = totalSale - totalPurchase;
                                        const profitLossPercent = purchasePrice > 0 ? (profitLoss / totalPurchase) * 100 : 0;
                                        const dateStr = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '-';

                                        return (
                                            <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4 font-bold text-gray-800">{tx.commodity_symbol}</td>
                                                <td className="px-6 py-4 text-right font-mono">{tx.amount}</td>
                                                <td className="px-6 py-4 text-right font-mono">${tx.price.toFixed(2)}</td>
                                                <td className="px-6 py-4 text-right font-mono">${totalSale.toFixed(2)}</td>
                                                <td className="px-6 py-4 text-xs font-semibold text-gray-500">{dateStr}</td>
                                                <td className="px-6 py-4 text-right font-mono text-gray-500">${purchasePrice.toFixed(2)}</td>
                                                <td className="px-6 py-4 text-right font-mono text-gray-500">${totalPurchase.toFixed(2)}</td>
                                                <td className={`px-6 py-4 text-right font-bold font-mono ${profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {profitLoss >= 0 ? '+' : ''}{profitLoss.toFixed(2)}
                                                </td>
                                                <td className={`px-6 py-4 text-right font-bold font-mono ${profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {profitLossPercent.toFixed(2)}%
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {history.length === 0 && (
                                        <tr>
                                            <td colSpan="9" className="px-6 py-12 text-center text-gray-400">
                                                No sales history yet.
                                            </td>
                                        </tr>
                                    )}
                                    {history.some(tx => tx.type === 'SELL') && (
                                        <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                                            <td colSpan="3" className="px-6 py-4 text-right text-gray-700">TOTAL</td>
                                            <td className="px-6 py-4 text-right font-mono text-gray-800">
                                                ${history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => sum + (tx.amount * tx.price), 0).toFixed(2)}
                                            </td>
                                            <td></td>
                                            <td></td>
                                            <td className="px-6 py-4 text-right font-mono text-gray-500">
                                                ${history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => sum + (tx.amount * (tx.cost_basis || 0)), 0).toFixed(2)}
                                            </td>
                                            <td className={`px-6 py-4 text-right font-mono ${history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => {
                                                const totalSale = tx.amount * tx.price;
                                                const totalPurchase = tx.amount * (tx.cost_basis || 0);
                                                return sum + (totalSale - totalPurchase);
                                            }, 0) >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                {history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => {
                                                    const totalSale = tx.amount * tx.price;
                                                    const totalPurchase = tx.amount * (tx.cost_basis || 0);
                                                    return sum + (totalSale - totalPurchase);
                                                }, 0) >= 0 ? '+' : ''}
                                                {history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => {
                                                    const totalSale = tx.amount * tx.price;
                                                    const totalPurchase = tx.amount * (tx.cost_basis || 0);
                                                    return sum + (totalSale - totalPurchase);
                                                }, 0).toFixed(2)}
                                            </td>
                                            <td className={`px-6 py-4 text-right font-mono ${history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => {
                                                const totalSale = tx.amount * tx.price;
                                                const totalPurchase = tx.amount * (tx.cost_basis || 0);
                                                return sum + (totalSale - totalPurchase);
                                            }, 0) >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                {(
                                                    (history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => {
                                                        const totalSale = tx.amount * tx.price;
                                                        const totalPurchase = tx.amount * (tx.cost_basis || 0);
                                                        return sum + (totalSale - totalPurchase);
                                                    }, 0) /
                                                        (history.filter(tx => tx.type === 'SELL').reduce((sum, tx) => sum + (tx.amount * (tx.cost_basis || 0)), 0) || 1)) * 100
                                                ).toFixed(2)}%
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}




            {/* STOP LOSS SETTINGS MODAL */}
            {showSlModal && slDraft && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[65]">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="p-4 bg-gray-800 text-white font-bold flex justify-between items-center">
                            <span className="text-lg">🛡️ Stop Loss Configuration</span>
                            <button onClick={() => setShowSlModal(false)} className="opacity-70 hover:opacity-100">✕</button>
                        </div>
                        <div className="p-6 space-y-5">
                            <label className="flex items-center justify-between cursor-pointer">
                                <div>
                                    <div className="font-semibold text-gray-800">Stop-loss monitoring</div>
                                    <div className="text-xs text-gray-500">Background checks on all open positions</div>
                                </div>
                                <input type="checkbox" className="w-5 h-5 accent-blue-600"
                                    checked={!!slDraft.enabled}
                                    onChange={(e) => setSlDraft({ ...slDraft, enabled: e.target.checked })} />
                            </label>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Default stop loss: <span className="font-black">{slDraft.default_pct}%</span>
                                </label>
                                <input type="range" min="1" max="50" step="0.5"
                                    className="w-full accent-blue-600"
                                    value={slDraft.default_pct}
                                    onChange={(e) => setSlDraft({ ...slDraft, default_pct: parseFloat(e.target.value) })} />
                                <div className="flex justify-between text-[10px] text-gray-400">
                                    <span>1% (tight)</span><span>10% (recommended)</span><span>50% (loose)</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">Applies to every position without a custom override.</div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">
                                    Early warning at <span className="font-black">{Math.round(slDraft.pre_warning_ratio * 100)}%</span> of the stop
                                    <span className="text-gray-400 font-normal"> ({(slDraft.default_pct * slDraft.pre_warning_ratio).toFixed(1)}% loss)</span>
                                </label>
                                <input type="range" min="0.5" max="0.95" step="0.05"
                                    className="w-full accent-yellow-500"
                                    value={slDraft.pre_warning_ratio}
                                    onChange={(e) => setSlDraft({ ...slDraft, pre_warning_ratio: parseFloat(e.target.value) })} />
                            </div>

                            <label className="flex items-center justify-between cursor-pointer border-t pt-4">
                                <div>
                                    <div className="font-semibold text-gray-800">Auto-execute (paper)</div>
                                    <div className="text-xs text-gray-500">Automatically close the position when the stop hits. Off = alert only, you decide.</div>
                                </div>
                                <input type="checkbox" className="w-5 h-5 accent-red-600"
                                    checked={!!slDraft.auto_execute}
                                    onChange={(e) => setSlDraft({ ...slDraft, auto_execute: e.target.checked })} />
                            </label>

                            <button
                                onClick={saveSlSettingsDraft}
                                className="w-full py-3 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg transition-transform hover:scale-[1.01] active:scale-95"
                            >
                                SAVE CONFIGURATION
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* TRADE MODAL */}
            {
                tradeModalOpen && (
                    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-[60]">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-up">
                            <div className={`p-4 text-white font-bold flex justify-between items-center ${tradeConfig.action === 'BUY' ? 'bg-green-600' : 'bg-red-600'}`}>
                                <span className="text-lg">{tradeConfig.action} {selectedCommodity?.symbol}</span>
                                <button onClick={() => setTradeModalOpen(false)} className="opacity-70 hover:opacity-100">✕</button>
                            </div>

                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Number of Shares</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={tradeConfig.quantity}
                                        onChange={(e) => setTradeConfig({ ...tradeConfig, quantity: e.target.value })}
                                        className="w-full border rounded-lg px-3 py-2 text-lg font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1">Strike Price ($)</label>
                                    <input
                                        type="number"
                                        value={tradeConfig.price}
                                        onChange={(e) => setTradeConfig({ ...tradeConfig, price: e.target.value })}
                                        className="w-full border rounded-lg px-3 py-2 text-lg font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                    <div className="text-xs text-gray-400 mt-1 flex justify-between">
                                        <span>Market: ${parseFloat(selectedCommodity?.price || 0).toFixed(2)}</span>
                                        <span onClick={() => setTradeConfig({ ...tradeConfig, price: parseFloat(selectedCommodity?.price).toFixed(2) })} className="text-blue-500 cursor-pointer hover:underline">Reset</span>
                                    </div>
                                </div>

                                <div className="pt-2 border-t mt-4">
                                    <div className="flex justify-between items-center mb-4">
                                        <span className="font-semibold text-gray-600">Total</span>
                                        <span className="font-black text-xl">${(tradeConfig.quantity * tradeConfig.price).toFixed(2)}</span>
                                    </div>
                                    <button
                                        onClick={executeTrade}
                                        className={`w-full py-3 rounded-lg font-bold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-95
                                        ${tradeConfig.action === 'BUY' ? 'bg-green-600 hover:bg-green-700 shadow-green-200' : 'bg-red-600 hover:bg-red-700 shadow-red-200'}`}
                                    >
                                        CONFIRM ORDER
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default Dashboard;
