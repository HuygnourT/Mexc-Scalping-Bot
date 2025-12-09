// MEXC Scalping Bot - Frontend UI
// This file only handles UI interactions and API calls to the server

let statusInterval = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('MEXC Scalping Bot UI loaded');
    
    // Button references
    const startBtn = document.getElementById('startScalpBtn');
    const stopBtn = document.getElementById('stopScalpBtn');
    const pauseBtn = document.getElementById('pauseScalpBtn');
    const resumeBtn = document.getElementById('resumeScalpBtn');
    const testOrderBtn = document.getElementById('testOrderBtn');
    const clearStatsBtn = document.getElementById('clearStatsBtn');
    const balanceBtn = document.getElementById('balanceBtn');

    // Event listeners
    balanceBtn.addEventListener('click', checkBalance);
    startBtn.addEventListener('click', startBot);
    stopBtn.addEventListener('click', stopBot);
    pauseBtn.addEventListener('click', pauseBot);
    resumeBtn.addEventListener('click', resumeBot);
    testOrderBtn.addEventListener('click', testOrder);
    clearStatsBtn.addEventListener('click', clearStats);

    // Initial status check
    fetchStatus();
});

function getConfig() {
    return {
        apiKey: document.getElementById('apiKey').value.trim(),
        apiSecret: document.getElementById('apiSecret').value.trim(),
        symbol: document.getElementById('symbol').value.trim(),
        tickSize: parseFloat(document.getElementById('scalpTickSize').value),
        maxBuyOrders: parseInt(document.getElementById('scalpMaxBuyOrders').value),
        offsetTicks: parseInt(document.getElementById('scalpOffsetTicks').value),
        layerStepTicks: parseInt(document.getElementById('scalpLayerStepTicks').value),
        buyTTL: parseInt(document.getElementById('scalpBuyTTL').value),
        repriceTicks: parseInt(document.getElementById('scalpRepriceTicks').value),
        tpTicks: parseInt(document.getElementById('scalpTPTicks').value),
        maxSellTPOrders: parseInt(document.getElementById('scalpMaxSellTPOrders').value),
        orderQty: parseFloat(document.getElementById('scalpOrderQty').value),
        loopInterval: parseInt(document.getElementById('scalpLoopInterval').value),
        waitAfterBuyFill: parseInt(document.getElementById('scalpWaitAfterBuyFill').value) || 0,
        sellAllOnStop: document.getElementById('scalpSellAllOnStop').checked
    };
}

function validateConfig(config) {
    if (!config.apiKey || !config.apiSecret) {
        alert('Please enter API Key and Secret');
        return false;
    }
    if (!config.symbol) {
        alert('Please enter Trading Symbol');
        return false;
    }
    if (config.orderQty <= 0) {
        alert('Order Quantity must be > 0');
        return false;
    }
    return true;
}

async function checkBalance() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiSecret = document.getElementById('apiSecret').value.trim();
    
    if (!apiKey || !apiSecret) {
        alert('Please enter API Key and Secret');
        return;
    }
    
    const balanceDisplay = document.getElementById('balanceDisplay');
    balanceDisplay.innerHTML = '<div style="text-align: center; color: #00d4aa;">⏳ Loading...</div>';
    balanceDisplay.classList.add('show');
    
    try {
        const response = await fetch('/api/wallet/balance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, apiSecret })
        });
        const data = await response.json();
        
        if (data.success && data.data.list && data.data.list[0]) {
            const coins = data.data.list[0].coin;
            const usdt = coins.find(c => c.coin === 'USDT');
            
            if (usdt) {
                balanceDisplay.innerHTML = `
                    <div style="font-weight: 600; margin-bottom: 10px; color: #00d4aa;">💰 Account Balance</div>
                    <div class="balance-item">
                        <span class="balance-label">USDT Available:</span>
                        <span class="balance-value">${parseFloat(usdt.walletBalance).toFixed(2)} USDT</span>
                    </div>
                    ${usdt.locked && parseFloat(usdt.locked) > 0 ? `
                    <div class="balance-item">
                        <span class="balance-label">Locked:</span>
                        <span class="balance-value">${parseFloat(usdt.locked).toFixed(2)} USDT</span>
                    </div>` : ''}
                `;
            } else {
                balanceDisplay.innerHTML = '<div style="color: #ef4444;">No USDT balance found</div>';
            }
        } else {
            balanceDisplay.innerHTML = `<div style="color: #ef4444;">Error: ${data.message || 'Unknown error'}</div>`;
        }
    } catch (error) {
        balanceDisplay.innerHTML = `<div style="color: #ef4444;">Error: ${error.message}</div>`;
    }
}

async function startBot() {
    const config = getConfig();
    if (!validateConfig(config)) return;
    
    try {
        const response = await fetch('/api/bot/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        const data = await response.json();
        
        if (data.success) {
            updateButtons(true, false);
            startStatusPolling();
        } else {
            alert('Failed to start: ' + data.message);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function stopBot() {
    try {
        const response = await fetch('/api/bot/stop', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            updateButtons(false, false);
            stopStatusPolling();
            fetchStatus();
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function pauseBot() {
    try {
        const response = await fetch('/api/bot/pause', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            updateButtons(true, true);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function resumeBot() {
    try {
        const response = await fetch('/api/bot/resume', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            updateButtons(true, false);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function testOrder() {
    const config = getConfig();
    if (!validateConfig(config)) return;
    
    try {
        const response = await fetch('/api/bot/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        const data = await response.json();
        alert(data.message);
        fetchStatus();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function clearStats() {
    try {
        const response = await fetch('/api/bot/clear-stats', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            fetchStatus();
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

function updateButtons(isRunning, isPaused) {
    const startBtn = document.getElementById('startScalpBtn');
    const stopBtn = document.getElementById('stopScalpBtn');
    const pauseBtn = document.getElementById('pauseScalpBtn');
    const resumeBtn = document.getElementById('resumeScalpBtn');
    const clearStatsBtn = document.getElementById('clearStatsBtn');
    
    startBtn.style.display = isRunning ? 'none' : 'block';
    stopBtn.style.display = isRunning ? 'block' : 'none';
    pauseBtn.style.display = isRunning && !isPaused ? 'block' : 'none';
    resumeBtn.style.display = isRunning && isPaused ? 'block' : 'none';
    clearStatsBtn.disabled = isRunning;
}

function startStatusPolling() {
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(fetchStatus, 1000);
}

function stopStatusPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
}

async function fetchStatus() {
    try {
        const response = await fetch('/api/bot/status');
        const data = await response.json();
        
        if (data.success) {
            renderStatus(data.data);
            updateButtons(data.data.isRunning, data.data.isPaused);
            
            if (data.data.isRunning && !statusInterval) {
                startStatusPolling();
            } else if (!data.data.isRunning && statusInterval) {
                stopStatusPolling();
            }
        }
    } catch (error) {
        console.error('Status fetch error:', error);
    }
}

function renderStatus(status) {
    const statusEl = document.getElementById('scalpStatus');
    const logsEl = document.getElementById('logsContent');
    
    // Render logs
    if (status.logs && status.logs.length > 0) {
        logsEl.innerHTML = status.logs.slice().reverse().map(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            return `<div class="log-item ${log.type}">[${time}] ${log.message}</div>`;
        }).join('');
    }
    
    if (status.isRunning || status.isPaused) {
        statusEl.classList.add('running');
        
        const formatPrice = p => p > 0 ? p.toFixed(6) : '-';
        const formatProfit = p => (p >= 0 ? '+' : '') + p.toFixed(6);
        
        let statusText = 'Bot Running';
        let statusClass = 'running';
        if (status.isPaused) {
            statusText = 'Bot Paused';
            statusClass = 'paused';
        } else if (status.isWaitingForMarketSell) {
            statusText = '⏳ Waiting Market Sell';
            statusClass = 'running';
        }
        
        const config = status.config || {};
        const stats = status.stats || {};
        const buyOrders = status.activeBuyOrders || [];
        const tpOrders = status.activeSellTPOrders || [];
        
        statusEl.innerHTML = `
            <div class="status-header-main ${statusClass}">
                <span class="status-dot"></span>
                <span>${statusText}</span>
            </div>
            <div class="stats-grid">
                <div class="stat-card buy-stats">
                    <div class="stat-icon">📥</div>
                    <div class="stat-content">
                        <div class="stat-label">Buy Orders</div>
                        <div class="stat-value">${stats.totalBuyOrdersFilled || 0} <span class="stat-total">/ ${stats.totalBuyOrdersCreated || 0}</span></div>
                    </div>
                </div>
                <div class="stat-card sell-stats">
                    <div class="stat-icon">📤</div>
                    <div class="stat-content">
                        <div class="stat-label">Sell Orders</div>
                        <div class="stat-value">${stats.totalSellOrdersFilled || 0} <span class="stat-total">/ ${stats.totalSellOrdersCreated || 0}</span></div>
                    </div>
                </div>
                <div class="stat-card profit-estimated">
                    <div class="stat-icon">📊</div>
                    <div class="stat-content">
                        <div class="stat-label">Est. Profit</div>
                        <div class="stat-value ${(status.estimatedProfit || 0) >= 0 ? 'positive' : 'negative'}">${formatProfit(status.estimatedProfit || 0)} USDT</div>
                    </div>
                </div>
                <div class="stat-card profit-real">
                    <div class="stat-icon">💰</div>
                    <div class="stat-content">
                        <div class="stat-label">Real Profit</div>
                        <div class="stat-value ${(stats.realProfit || 0) >= 0 ? 'positive' : 'negative'}">${formatProfit(stats.realProfit || 0)} USDT</div>
                    </div>
                </div>
                <div class="stat-card avg-price">
                    <div class="stat-icon">⚖️</div>
                    <div class="stat-content">
                        <div class="stat-label">Avg Buy Price</div>
                        <div class="stat-value">${formatPrice(status.avgBuyPrice || 0)}</div>
                        <div class="stat-detail">Qty: ${(status.totalPendingQty || 0).toFixed(4)}</div>
                    </div>
                </div>
                <div class="stat-card active-orders">
                    <div class="stat-icon">📋</div>
                    <div class="stat-content">
                        <div class="stat-label">Active Orders</div>
                        <div class="stat-value">${buyOrders.length + tpOrders.length}</div>
                        <div class="stat-detail">Buy: ${buyOrders.length} | TP: ${tpOrders.length}</div>
                    </div>
                </div>
            </div>
            <div class="orders-section">
                <div class="orders-panel" style="${status.isPaused ? 'opacity: 0.5;' : ''}">
                    <div class="panel-header">
                        <span>${status.isPaused ? '🛑' : '🟢'}</span>
                        <span>Buy Orders (${buyOrders.length}/${config.maxBuyOrders || 3})</span>
                    </div>
                    <div class="orders-list">
                        ${buyOrders.length > 0 ? buyOrders.map(o => `
                            <div class="order-item buy-order">
                                <span class="order-layer">L${o.layer}</span>
                                <span class="order-price">${o.price.toFixed(6)}</span>
                                <span class="order-qty">${o.qty}</span>
                                <span class="order-age">${Math.floor((Date.now() - o.timestamp) / 1000)}s</span>
                            </div>
                        `).join('') : '<div class="no-orders">No active buy orders</div>'}
                    </div>
                </div>
                <div class="orders-panel">
                    <div class="panel-header">
                        <span>🔵</span>
                        <span>TP Orders (${tpOrders.length}/${config.maxSellTPOrders || 20})</span>
                    </div>
                    <div class="orders-list">
                        ${tpOrders.length > 0 ? tpOrders.map(o => `
                            <div class="order-item tp-order">
                                <span class="order-price">${o.price.toFixed(6)}</span>
                                <span class="order-qty">${o.qty}</span>
                                <span class="order-profit">+${((o.price - o.buyPrice) * o.qty).toFixed(6)}</span>
                            </div>
                        `).join('') : '<div class="no-orders">No active TP orders</div>'}
                    </div>
                </div>
            </div>
        `;
    } else {
        statusEl.classList.remove('running');
        const stats = status.stats || {};
        
        statusEl.innerHTML = `
            <div class="status-header-main">
                <span class="status-dot stopped"></span>
                <span>Bot Stopped</span>
            </div>
            <div class="final-stats">
                <div class="final-stat">
                    <span class="final-label">Buy Orders:</span>
                    <span class="final-value">${stats.totalBuyOrdersFilled || 0} / ${stats.totalBuyOrdersCreated || 0}</span>
                </div>
                <div class="final-stat">
                    <span class="final-label">Sell Orders:</span>
                    <span class="final-value">${stats.totalSellOrdersFilled || 0} / ${stats.totalSellOrdersCreated || 0}</span>
                </div>
                <div class="final-stat">
                    <span class="final-label">Real Profit:</span>
                    <span class="final-value ${(stats.realProfit || 0) >= 0 ? 'positive' : 'negative'}">${(stats.realProfit || 0) >= 0 ? '+' : ''}${(stats.realProfit || 0).toFixed(6)} USDT</span>
                </div>
            </div>
        `;
    }
}
