import React, { useEffect, useState } from 'react';
import { fetchCommodities, placeTrade, fetchHoldings, createHolding, updateHolding, deleteHolding, fetchHistory, searchCommodities, addCommodity, deleteCommodity as deleteCommodityAPI, fetchCommodityHistory } from '../api';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const Dashboard = () => {
    const [activeTab, setActiveTab] = useState('market'); // 'market' | 'holdings'

    // Market State
    const [commodities, setCommodities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCommodity, setSelectedCommodity] = useState(null);
    const [historyData, setHistoryData] = useState([]); // Chart data
    const [timeRange, setTimeRange] = useState('1M'); // Time range state

    const [tradeAmount, setTradeAmount] = useState(100);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [isSearching, setIsSearching] = useState(false);

    const TIME_RANGES = {
        '1D': 1,
        '1W': 7,
        '1M': 30,
        '1Y': 365,
        'YTD': Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)),
        '3Y': 1095,
        '5Y': 1825
    };

    // Fetch History when commodity or timeRange selected
    useEffect(() => {
        if (selectedCommodity) {
            const days = TIME_RANGES[timeRange] || 30;
            fetchCommodityHistory(selectedCommodity.symbol, days)
                .then(data => setHistoryData(data))
                .catch(err => console.error("Failed to load history chart", err));
        }
    }, [selectedCommodity, timeRange]);

    // Holdings State
    const [holdings, setHoldings] = useState([]);
    const [history, setHistory] = useState([]);
    const [loadingHoldings, setLoadingHoldings] = useState(false);
    const [editingHolding, setEditingHolding] = useState(null); // null or holding object

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
            const [data, hist] = await Promise.all([fetchHoldings(), fetchHistory()]);
            setHoldings(data);
            setHistory(hist);
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
                <div className="flex justify-end mb-4">
                    <button
                        onClick={() => setShowSearchModal(true)}
                        className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm shadow hover:bg-gray-700 transition"
                    >
                        + Add Symbol
                    </button>
                </div>
            )}

            {/* MARKET TAB */}
            {activeTab === 'market' && (
                <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-200px)] min-h-[600px]">
                    {/* LEFT: Master List */}
                    <div className="lg:w-[350px] flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar shrink-0">
                        {commodities.map((item) => (
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
                                    <div className="flex justify-end gap-1 mb-2">
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
                                                    dataKey="day"
                                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                                    tickFormatter={(val) => `D${val}`}
                                                />
                                                <YAxis
                                                    domain={['auto', 'auto']}
                                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                                    tickFormatter={(value) => `$${value.toFixed(0)}`}
                                                    width={40}
                                                />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                    labelStyle={{ display: 'none' }}
                                                    formatter={(value) => [`$${value.toFixed(2)}`, 'Price']}
                                                />
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

                                            {/* Smart Money & Political Flow */}
                                            {selectedCommodity.recommendation.unusual_flow && (
                                                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                                                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                                        <span className="text-lg">💼</span> Smart Money & Political Flow
                                                    </h3>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                        <div className="flex flex-col gap-3">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-gray-400 uppercase">Insider Activity</span>
                                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${selectedCommodity.recommendation.unusual_flow.insider_status.includes('Buying') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                                                    {selectedCommodity.recommendation.unusual_flow.insider_status}
                                                                </span>
                                                            </div>
                                                            <div className="space-y-2">
                                                                {selectedCommodity.recommendation.unusual_flow.insider_trades?.length > 0 ? (
                                                                    selectedCommodity.recommendation.unusual_flow.insider_trades.map((tx, idx) => (
                                                                        <div key={idx} className="flex justify-between items-center text-[11px] border-b border-gray-50 pb-2">
                                                                            <div className="font-bold text-gray-800">{tx.name || 'Officer'}</div>
                                                                            <div className={tx.change > 0 ? 'text-green-600' : 'text-red-600'}>
                                                                                {tx.change > 0 ? '+' : ''}{tx.change?.toLocaleString()} shrs
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <div className="text-[10px] text-gray-400 italic">No recent Form 4 filings.</div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-col gap-3">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-gray-400 uppercase">Congressional Flow</span>
                                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${selectedCommodity.recommendation.unusual_flow.political_status.includes('Bullish') ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                                                    {selectedCommodity.recommendation.unusual_flow.political_status}
                                                                </span>
                                                            </div>
                                                            <div className="space-y-2">
                                                                {selectedCommodity.recommendation.unusual_flow.political_trades?.length > 0 ? (
                                                                    selectedCommodity.recommendation.unusual_flow.political_trades.map((tx, idx) => (
                                                                        <div key={idx} className="flex justify-between items-center text-[11px] border-b border-gray-50 pb-2">
                                                                            <div className="font-bold text-gray-800">{tx.representative || 'Official'}</div>
                                                                            <div className={tx.transactionType === 'Purchase' ? 'text-green-600' : 'text-red-600'}>
                                                                                {tx.transactionType}
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <div className="text-[10px] text-gray-400 italic">No recent political disclosures.</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
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
                            <button
                                onClick={() => setEditingHolding({ symbol: '', quantity: 0, avg_price: 0 })}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
                            >
                                + Add Entry
                            </button>
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
                                            <td colSpan="7" className="px-6 py-12 text-center text-gray-400">
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
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>



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
