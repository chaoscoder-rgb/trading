import React, { useEffect, useState } from 'react';
import { fetchCommodities, placeTrade, fetchHoldings, createHolding, updateHolding, deleteHolding, fetchHistory, searchCommodities, addCommodity, deleteCommodity as deleteCommodityAPI } from '../api';

const Dashboard = () => {
    const [activeTab, setActiveTab] = useState('market'); // 'market' | 'holdings'

    // Market State
    const [commodities, setCommodities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCommodity, setSelectedCommodity] = useState(null);
    const [tradeAmount, setTradeAmount] = useState(100);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [isSearching, setIsSearching] = useState(false);

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
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-24">
                        {commodities.map((item) => (
                            <div
                                key={item.symbol}
                                className={`border rounded-xl p-6 shadow-sm hover:shadow-lg transition-all cursor-pointer bg-white relative overflow-hidden group
                                    ${selectedCommodity?.symbol === item.symbol ? 'ring-2 ring-blue-500 border-transparent transform scale-[1.02]' : 'border-gray-200'}`}
                                onClick={() => setSelectedCommodity(item)}
                            >
                                <button
                                    onClick={(e) => handleDeleteCommodity(e, item.symbol)}
                                    className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Remove from watchlist"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h2 className="text-2xl font-bold text-gray-800">{item.symbol}</h2>
                                        <p className="text-sm text-gray-600 font-medium">{item.name}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-2xl font-mono font-medium">${parseFloat(item.price || 0).toFixed(2)}</div>
                                        <div className={`text-sm font-bold ${item.risk.level === 'Low' ? 'text-green-600' :
                                            item.risk.level === 'Medium' ? 'text-yellow-600' : 'text-red-600'
                                            }`}>
                                            {item.risk.level} Risk
                                        </div>
                                    </div>
                                </div>

                                {/* Recommendation Pill */}
                                <div className="mb-4">
                                    <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                                        <span className="text-sm font-medium text-gray-500">Signal</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-gray-400">{item.recommendation.confidence}% Conf.</span>
                                            <span className={`px-3 py-1 rounded-full text-sm font-bold text-white shadow-sm
                                                ${item.recommendation.action.includes('Buy') ? 'bg-green-500' :
                                                    item.recommendation.action.includes('Sell') ? 'bg-red-500' : 'bg-gray-500'}`}>
                                                {item.recommendation.action}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Quick Analysis Preview (First bullet) */}
                                {item.recommendation.analysis?.positives?.[0] && (
                                    <div className="text-sm text-gray-600 flex items-start gap-2">
                                        <span className="text-green-500 font-bold">↑</span>
                                        <span className="truncate">{item.recommendation.analysis.positives[0].text}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* DETAIL PANEL */}
                    {selectedCommodity && (
                        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-gray-100 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] p-6 z-50 animate-slide-up">
                            <div className="container mx-auto flex flex-col lg:flex-row gap-8 max-w-7xl">
                                {/* Left: Action */}
                                <div className="lg:w-1/4 flex flex-col justify-between border-r pr-6">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <h2 className="text-3xl font-bold text-gray-900">{selectedCommodity.symbol} <span className="text-lg font-normal text-gray-500 ml-2">{selectedCommodity.name}</span></h2>
                                            <span className="text-2xl font-mono">${parseFloat(selectedCommodity.price || 0).toFixed(2)}</span>
                                        </div>

                                        <div className="mb-6">
                                            <div className="text-sm text-gray-500 mb-1">Confidence Score</div>
                                            <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-500 ${selectedCommodity.recommendation.confidence > 60 ? 'bg-green-500' : 'bg-yellow-500'
                                                        }`}
                                                    style={{ width: `${selectedCommodity.recommendation.confidence}%` }}
                                                />
                                            </div>
                                            <div className="text-right text-xs font-bold mt-1">{selectedCommodity.recommendation.confidence}%</div>
                                        </div>

                                        {/* Holding Info in Detail Panel */}
                                        {(() => {
                                            const myHolding = holdings.find(h => h.symbol === selectedCommodity.symbol);
                                            if (myHolding) {
                                                const diff = selectedCommodity.price - myHolding.avg_price;
                                                const diffPercent = (diff / myHolding.avg_price) * 100;
                                                const isPositive = diff >= 0;
                                                return (
                                                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
                                                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Your Position</h4>
                                                        <div className="flex justify-between items-end mb-1">
                                                            <span className="text-gray-700 font-medium">Qty: {myHolding.quantity}</span>
                                                            <span className={`font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                                                {isPositive ? '+' : ''}{diffPercent.toFixed(2)}%
                                                            </span>
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            Avg: ${myHolding.avg_price.toFixed(2)}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => openTradeModal('BUY')}
                                            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold shadow-lg shadow-green-200 transition-all"
                                        >
                                            BUY
                                        </button>
                                        <button
                                            onClick={() => openTradeModal('SELL')}
                                            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-bold shadow-lg shadow-red-200 transition-all"
                                        >
                                            SELL
                                        </button>
                                    </div>
                                </div>

                                {/* Middle: Analysis */}
                                <div className="lg:w-1/2 flex flex-col md:flex-row gap-6">
                                    <div className="flex-1 bg-green-50 rounded-xl p-4 border border-green-100">
                                        <h3 className="font-bold text-green-800 mb-3 flex items-center gap-2">
                                            <span className="bg-green-200 rounded p-1">👍</span> Positives
                                        </h3>
                                        <ul className="space-y-3">
                                            {selectedCommodity.recommendation.analysis?.positives?.map((p, i) => (
                                                <li key={i} className="text-sm text-green-900 flex items-start gap-2">
                                                    <span className="mt-1">•</span>
                                                    <div>
                                                        <div>{p.text}</div>
                                                        <div className="text-xs text-green-600 font-semibold mt-0.5">— {p.source}</div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    <div className="flex-1 bg-red-50 rounded-xl p-4 border border-red-100">
                                        <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
                                            <span className="bg-red-200 rounded p-1">👎</span> Negatives
                                        </h3>
                                        <ul className="space-y-3">
                                            {selectedCommodity.recommendation.analysis?.negatives?.map((n, i) => (
                                                <li key={i} className="text-sm text-red-900 flex items-start gap-2">
                                                    <span className="mt-1">•</span>
                                                    <div>
                                                        <div>{n.text}</div>
                                                        <div className="text-xs text-red-600 font-semibold mt-0.5">— {n.source}</div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>

                                {/* Right: Polymarket Polls */}
                                <div className="lg:w-1/4 border-l pl-6 overflow-y-auto max-h-[400px]">
                                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                                        <span className="text-blue-500">📊</span> Top Predictions
                                    </h3>

                                    <div className="space-y-4">
                                        {selectedCommodity.recommendation.polls?.length > 0 ? (
                                            selectedCommodity.recommendation.polls.map((poll, idx) => (
                                                <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 hover:border-blue-200 transition-colors">
                                                    <p className="text-sm font-medium text-gray-800 mb-2 leading-tight">{poll.question}</p>

                                                    <div className="flex items-center gap-2 mb-1">
                                                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden flex">
                                                            <div className="bg-green-500 h-full" style={{ width: `${poll.yes}%` }} />
                                                            <div className="bg-red-500 h-full" style={{ width: `${poll.no}%` }} />
                                                        </div>
                                                    </div>

                                                    <div className="flex justify-between text-xs font-bold">
                                                        <span className="text-green-600">Yes {poll.yes}%</span>
                                                        <span className="text-red-600">No {poll.no}%</span>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-sm text-gray-500 italic p-4 text-center">
                                                No relevant polls found for this commodity.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
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
