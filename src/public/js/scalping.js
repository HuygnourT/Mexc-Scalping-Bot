// MEXC Scalping Trading Bot Module
// Implements Maker-Based Scalping Strategy for MEXC Spot

class ScalpingBot {
    constructor() {
        this.isRunning = false;
        this.isPaused = false;
        this.config = {};
        this.activeBuyOrders = [];
        this.activeSellTPOrders = [];
        this.loopInterval = null;
        this.lastBuyFillTime = 0;
        
        // Market sell tracking
        this.isWaitingForMarketSell = false;
        this.pendingMarketSell = null;
        this.pendingNewTP = null;
        
        // Statistics tracking
        this.stats = {
            totalBuyOrdersCreated: 0,
            totalBuyOrdersFilled: 0,
            totalBuyOrdersCanceled: 0,
            totalSellOrdersCreated: 0,
            totalSellOrdersFilled: 0,
            totalSellOrdersCanceled: 0,
            realProfit: 0,
            totalFees: 0,
            pendingPositions: []
        };
    }

    init(config) {
        this.config = config;
        this.resetStats();
        this.log('Bot initialized with config', 'info');
        this.log(`Symbol: ${config.symbol}, Tick Size: ${config.tickSize}`, 'info');
        this.log(`Wait After Buy Fill: ${config.waitAfterBuyFill}ms`, 'info');
        this.log(`Sell All On Stop: ${config.sellAllOnStop ? 'YES' : 'NO'}`, 'info');
    }

    resetStats() {
        this.stats = {
            totalBuyOrdersCreated: 0,
            totalBuyOrdersFilled: 0,
            totalBuyOrdersCanceled: 0,
            totalSellOrdersCreated: 0,
            totalSellOrdersFilled: 0,
            totalSellOrdersCanceled: 0,
            realProfit: 0,
            totalFees: 0,
            pendingPositions: []
        };
        this.isWaitingForMarketSell = false;
        this.pendingMarketSell = null;
        this.pendingNewTP = null;
    }

    calculateEstimatedProfit() {
        let estimatedProfit = this.stats.realProfit;
        for (let order of this.activeSellTPOrders) {
            estimatedProfit += (order.price - order.buyPrice) * order.qty;
        }
        return estimatedProfit;
    }

    calculateAvgBuyPrice() {
        if (this.stats.pendingPositions.length === 0) return 0;
        let totalValue = 0, totalQty = 0;
        for (let position of this.stats.pendingPositions) {
            totalValue += position.buyPrice * position.qty;
            totalQty += position.qty;
        }
        return totalQty > 0 ? totalValue / totalQty : 0;
    }

    calculateTotalPendingQty() {
        return this.stats.pendingPositions.reduce((sum, p) => sum + p.qty, 0);
    }

    async start() {
        if (this.isRunning) {
            this.log('Bot is already running', 'warning');
            return;
        }
        this.isRunning = true;
        this.isPaused = false;
        this.updateStatus('running');
        this.log('🚀 Bot started', 'success');
        this.runMainLoop();
    }

    async testSingleOrder() {
        this.log('🧪 Starting test single order...', 'info');
        let currentOrderId = null;
        let orderFilled = false;
        let repricingAttempts = 0;
        const maxRepricingAttempts = 10;
        
        try {
            while (!orderFilled && repricingAttempts < maxRepricingAttempts) {
                repricingAttempts++;
                if (repricingAttempts > 1) {
                    this.log(`🔄 Repricing attempt #${repricingAttempts}/${maxRepricingAttempts}`, 'warning');
                }
                
                const orderbook = await this.fetchOrderbook();
                if (!orderbook) {
                    this.log('❌ Failed to fetch orderbook', 'error');
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                const bestBid = orderbook.bestBid;
                this.log(`Best Bid: ${bestBid}`, 'info');

                let buyPrice = this.roundToTick(bestBid + (this.config.offsetTicks * this.config.tickSize));
                this.log(`Placing BUY order at ${buyPrice} for ${this.config.orderQty}...`, 'info');
                
                currentOrderId = await this.placeLimitOrder('Buy', buyPrice, this.config.orderQty);
                if (!currentOrderId) {
                    this.log('❌ Failed to place buy order, retrying...', 'error');
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                this.stats.totalBuyOrdersCreated++;
                this.log(`✅ Buy order placed: ${currentOrderId}`, 'success');

                const checkInterval = 2000;
                const maxAttempts = Math.ceil((this.config.buyTTL * 1000) / checkInterval);
                const orderPlacedTime = Date.now();
                let attempts = 0;
                let shouldReprice = false;

                while (attempts < maxAttempts && !orderFilled && !shouldReprice) {
                    await new Promise(r => setTimeout(r, checkInterval));
                    attempts++;
                    
                    const currentOrderbook = await this.fetchOrderbook();
                    if (currentOrderbook) {
                        const tickDiff = Math.abs(buyPrice - currentOrderbook.bestBid) / this.config.tickSize;
                        if (tickDiff >= this.config.repriceTicks) {
                            this.log(`🔄 Price moved ${tickDiff.toFixed(1)} ticks. Need repricing!`, 'warning');
                            shouldReprice = true;
                            break;
                        }
                    }
                    
                    const status = await this.checkOrderStatus(currentOrderId);
                    if (status?.filled) {
                        orderFilled = true;
                        this.stats.totalBuyOrdersFilled++;
                        this.lastBuyFillTime = Date.now();
                        this.log(`✅ Buy order filled at ${buyPrice}!`, 'success');
                        await this.createSellTPOrder(buyPrice, this.config.orderQty);
                        this.log('🎉 Test completed successfully!', 'success');
                        break;
                    }
                }

                if (shouldReprice || (attempts >= maxAttempts && !orderFilled)) {
                    await this.cancelOrder(currentOrderId);
                    this.stats.totalBuyOrdersCanceled++;
                    this.log('Order canceled. Creating new order...', 'info');
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (!orderFilled) {
                this.log(`❌ Test ended: Order not filled after ${repricingAttempts} attempts`, 'error');
            }
        } catch (error) {
            this.log(`Test error: ${error.message}`, 'error');
            if (currentOrderId) {
                await this.cancelOrder(currentOrderId);
                this.stats.totalBuyOrdersCanceled++;
            }
        }
    }

    async stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.isPaused = false;
        
        if (this.loopInterval) {
            clearTimeout(this.loopInterval);
            this.loopInterval = null;
        }
        
        this.log('⏹️ Stopping bot...', 'warning');
        this.updateStatus('stopping');

        for (const order of this.activeBuyOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalBuyOrdersCanceled++;
        }
        this.activeBuyOrders = [];

        if (this.config.sellAllOnStop && this.activeSellTPOrders.length > 0) {
            this.log('💰 Sell All On Stop - Selling at market...', 'warning');
            await this.sellAllAtMarket();
        } else {
            await this.cancelAllTPOrders();
        }

        this.updateStatus('stopped');
        this.log('⏹️ Bot stopped', 'warning');
    }

    async sellAllAtMarket() {
        if (this.activeSellTPOrders.length === 0) return;

        const orderbook = await this.fetchOrderbook();
        if (!orderbook) {
            await this.cancelAllTPOrders();
            return;
        }

        const bestBid = orderbook.bestBid;
        for (const order of this.activeSellTPOrders) {
            try {
                await this.cancelOrder(order.orderId);
                this.stats.totalSellOrdersCanceled++;
                
                const sellOrderId = await this.placeMarketOrder('Sell', order.qty);
                if (sellOrderId) {
                    const profitLoss = (bestBid - order.buyPrice) * order.qty;
                    this.stats.realProfit += profitLoss;
                    this.stats.totalSellOrdersFilled++;
                    this.log(`💰 Market sold ${order.qty} @ ~${bestBid}, P/L: ${profitLoss.toFixed(6)} USDT`, profitLoss >= 0 ? 'success' : 'error');
                }
            } catch (error) {
                this.log(`Error selling: ${error.message}`, 'error');
            }
        }
        this.activeSellTPOrders = [];
    }

    async cancelAllTPOrders() {
        for (const order of this.activeSellTPOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalSellOrdersCanceled++;
        }
        this.activeSellTPOrders = [];
        this.stats.pendingPositions = [];
    }

    async placeMarketOrder(side, qty) {
        try {
            const response = await fetch('/api/order/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.config.apiKey,
                    apiSecret: this.config.apiSecret,
                    symbol: this.config.symbol,
                    side: side,
                    orderType: 'Market',
                    qty: qty.toString()
                })
            });
            const data = await response.json();
            return data.success ? data.data.orderId : null;
        } catch (error) {
            this.log(`Market order error: ${error.message}`, 'error');
            return null;
        }
    }

    async pause() {
        if (!this.isRunning || this.isPaused) return;
        this.isPaused = true;
        this.log('⏸️ Pausing - Canceling buy orders, keeping TP...', 'warning');

        for (const order of this.activeBuyOrders) {
            await this.cancelOrder(order.orderId);
            this.stats.totalBuyOrdersCanceled++;
        }
        this.activeBuyOrders = [];
        this.updateStatus('paused');
        this.log(`⏸️ Paused. ${this.activeSellTPOrders.length} TP orders active.`, 'warning');
    }

    async resume() {
        if (!this.isRunning || !this.isPaused) return;
        this.isPaused = false;
        this.updateStatus('running');
        this.log('▶️ Resumed - Creating new buy orders...', 'success');
    }

    async runMainLoop() {
        if (!this.isRunning) return;

        try {
            if (this.isWaitingForMarketSell && this.pendingMarketSell) {
                await this.checkMarketSellStatus();
            }
            
            const orderbook = await this.fetchOrderbook();
            if (orderbook) {
                this.log(`Orderbook: Bid=${orderbook.bestBid}, Ask=${orderbook.bestAsk}`, 'info');

                if (!this.isPaused && !this.isWaitingForMarketSell) {
                    await this.updateBuyOrders(orderbook.bestBid);
                    await this.createBuyOrders(orderbook.bestBid);
                }
                await this.updateSellTPOrders();
            }
        } catch (error) {
            this.log(`Loop error: ${error.message}`, 'error');
        }

        this.updateStatus(this.isPaused ? 'paused' : (this.isWaitingForMarketSell ? 'waiting_market_sell' : 'running'));

        if (this.isRunning) {
            this.loopInterval = setTimeout(() => this.runMainLoop(), this.config.loopInterval);
        }
    }

    async fetchOrderbook() {
        try {
            const response = await fetch('/api/orderbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol: this.config.symbol })
            });
            const data = await response.json();
            if (data.success && data.data) {
                return {
                    bestBid: parseFloat(data.data.bestBid),
                    bestAsk: parseFloat(data.data.bestAsk)
                };
            }
            return null;
        } catch (error) {
            this.log(`Orderbook error: ${error.message}`, 'error');
            return null;
        }
    }

    async updateBuyOrders(bestBid) {
        const now = Date.now();
        const ordersToRemove = [];
        
        for (let i = 0; i < this.activeBuyOrders.length; i++) {
            const order = this.activeBuyOrders[i];
            const age = (now - order.timestamp) / 1000;
            const status = await this.checkOrderStatus(order.orderId);

            if (status.filled) {
                this.log(`✅ Buy ${order.orderId} filled at ${order.price}`, 'success');
                this.stats.totalBuyOrdersFilled++;
                this.lastBuyFillTime = Date.now();
                await this.createSellTPOrder(order.price, order.qty);
                ordersToRemove.push(i);
                continue;
            }

            if (age >= this.config.buyTTL) {
                this.log(`Order ${order.orderId} expired`, 'warning');
                await this.cancelOrder(order.orderId);
                this.stats.totalBuyOrdersCanceled++;
                if (order.filledQty > 0) {
                    this.stats.totalBuyOrdersFilled++;
                    await this.createSellTPOrder(order.price, order.filledQty);
                }
                ordersToRemove.push(i);
                continue;
            }

            const tickDiff = Math.abs(order.price - bestBid) / this.config.tickSize;
            if (tickDiff >= this.config.repriceTicks) {
                this.log(`Repricing ${order.orderId} (${tickDiff.toFixed(1)} ticks)`, 'info');
                await this.cancelOrder(order.orderId);
                this.stats.totalBuyOrdersCanceled++;
                ordersToRemove.push(i);
            }
        }

        for (let i = ordersToRemove.length - 1; i >= 0; i--) {
            this.activeBuyOrders.splice(ordersToRemove[i], 1);
        }
    }

    async createBuyOrders(bestBid) {
        const needed = this.config.maxBuyOrders - this.activeBuyOrders.length;
        if (needed <= 0) return;

        if (this.config.waitAfterBuyFill > 0 && this.lastBuyFillTime > 0) {
            const timeSince = Date.now() - this.lastBuyFillTime;
            if (timeSince < this.config.waitAfterBuyFill) {
                this.log(`⏱️ Waiting ${this.config.waitAfterBuyFill - timeSince}ms...`, 'info');
                return;
            }
        }

        const existingLayers = this.activeBuyOrders.map(o => o.layer);
        const existingPrices = this.activeBuyOrders.map(o => o.price);

        for (let layer = 0; layer < this.config.maxBuyOrders; layer++) {
            if (existingLayers.includes(layer)) continue;
            
            const offsetTicks = this.config.offsetTicks + (layer * this.config.layerStepTicks);
            let buyPrice = this.roundToTick(bestBid - (offsetTicks * this.config.tickSize));
            
            const hasConflict = existingPrices.some(p => Math.abs(p - buyPrice) < this.config.tickSize * 0.5);
            if (hasConflict) {
                buyPrice = this.roundToTick(buyPrice + this.config.layerStepTicks * this.config.tickSize);
            }
            
            existingPrices.push(buyPrice);
            this.log(`Creating BUY at ${buyPrice} (layer ${layer})`, 'info');

            const orderId = await this.placeLimitOrder('Buy', buyPrice, this.config.orderQty);
            if (orderId) {
                this.stats.totalBuyOrdersCreated++;
                this.activeBuyOrders.push({
                    orderId, price: buyPrice, qty: this.config.orderQty,
                    filledQty: 0, timestamp: Date.now(), layer
                });
            }

            if (this.activeBuyOrders.length >= this.config.maxBuyOrders) break;
        }
    }

    roundToTick(price) {
        const tickSize = this.config.tickSize;
        const tickStr = tickSize.toString();
        const decimals = tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
        return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(decimals));
    }

    async createSellTPOrder(buyPrice, qty) {
        if (this.activeSellTPOrders.length >= this.config.maxSellTPOrders) {
            this.log(`⚠️ Max TP orders (${this.config.maxSellTPOrders}) reached!`, 'warning');
            
            let highestIdx = 0;
            for (let i = 1; i < this.activeSellTPOrders.length; i++) {
                if (this.activeSellTPOrders[i].price > this.activeSellTPOrders[highestIdx].price) {
                    highestIdx = i;
                }
            }
            
            const highest = this.activeSellTPOrders[highestIdx];
            await this.cancelOrder(highest.orderId);
            this.stats.totalSellOrdersCanceled++;
            this.activeSellTPOrders.splice(highestIdx, 1);
            
            this.isWaitingForMarketSell = true;
            this.pendingNewTP = { buyPrice, qty };
            
            const marketOrderId = await this.placeMarketOrder('Sell', highest.qty);
            if (marketOrderId) {
                this.pendingMarketSell = {
                    orderId: marketOrderId, qty: highest.qty,
                    buyPrice: highest.buyPrice, timestamp: Date.now()
                };
            } else {
                this.isWaitingForMarketSell = false;
                this.pendingNewTP = null;
            }
            return;
        }

        const tpPrice = this.roundToTick(buyPrice + (this.config.tpTicks * this.config.tickSize));
        this.log(`Creating SELL TP at ${tpPrice} for ${qty}`, 'success');

        const orderId = await this.placeLimitOrder('Sell', tpPrice, qty);
        if (orderId) {
            this.stats.totalSellOrdersCreated++;
            this.activeSellTPOrders.push({ orderId, price: tpPrice, qty, buyPrice, timestamp: Date.now() });
            this.stats.pendingPositions.push({ orderId, buyPrice, qty, sellPrice: tpPrice });
        }
    }

    async checkMarketSellStatus() {
        if (!this.pendingMarketSell) return;
        
        const status = await this.checkOrderStatus(this.pendingMarketSell.orderId);
        const elapsed = (Date.now() - this.pendingMarketSell.timestamp) / 1000;
        
        if (status.filled) {
            const orderbook = await this.fetchOrderbook();
            const sellPrice = orderbook ? orderbook.bestBid : this.pendingMarketSell.buyPrice;
            const profitLoss = (sellPrice - this.pendingMarketSell.buyPrice) * this.pendingMarketSell.qty;
            this.stats.realProfit += profitLoss;
            this.stats.totalSellOrdersFilled++;
            
            this.log(`💰 Market sell FILLED! P/L: ${profitLoss.toFixed(6)} USDT`, profitLoss >= 0 ? 'success' : 'error');
            
            if (this.pendingNewTP) {
                const tpPrice = this.roundToTick(this.pendingNewTP.buyPrice + (this.config.tpTicks * this.config.tickSize));
                const orderId = await this.placeLimitOrder('Sell', tpPrice, this.pendingNewTP.qty);
                if (orderId) {
                    this.stats.totalSellOrdersCreated++;
                    this.activeSellTPOrders.push({
                        orderId, price: tpPrice, qty: this.pendingNewTP.qty,
                        buyPrice: this.pendingNewTP.buyPrice, timestamp: Date.now()
                    });
                }
            }
            
            this.isWaitingForMarketSell = false;
            this.pendingMarketSell = null;
            this.pendingNewTP = null;
            this.log(`▶️ Resuming buy orders...`, 'success');
        } else if (elapsed > 30) {
            this.log(`⚠️ Market sell timeout!`, 'error');
            this.isWaitingForMarketSell = false;
            this.pendingMarketSell = null;
            this.pendingNewTP = null;
        }
    }

    async updateSellTPOrders() {
        const ordersToRemove = [];

        for (let i = 0; i < this.activeSellTPOrders.length; i++) {
            const order = this.activeSellTPOrders[i];
            const status = await this.checkOrderStatus(order.orderId);
            
            if (status.filled) {
                const profit = (order.price - order.buyPrice) * order.qty;
                this.stats.totalSellOrdersFilled++;
                this.stats.realProfit += profit;
                
                const idx = this.stats.pendingPositions.findIndex(p => p.orderId === order.orderId);
                if (idx !== -1) this.stats.pendingPositions.splice(idx, 1);
                
                this.log(`💰 TP filled! Profit: ${profit.toFixed(6)} USDT`, 'success');
                ordersToRemove.push(i);
            }
        }

        for (let i = ordersToRemove.length - 1; i >= 0; i--) {
            this.activeSellTPOrders.splice(ordersToRemove[i], 1);
        }
    }

    async placeLimitOrder(side, price, qty) {
        try {
            const response = await fetch('/api/order/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.config.apiKey,
                    apiSecret: this.config.apiSecret,
                    symbol: this.config.symbol,
                    side, orderType: 'Limit',
                    qty: qty.toString(),
                    price: price.toString()
                })
            });
            const data = await response.json();
            if (data.success) return data.data.orderId;
            this.log(`Order failed: ${data.message}`, 'error');
            return null;
        } catch (error) {
            this.log(`Order error: ${error.message}`, 'error');
            return null;
        }
    }

    async checkOrderStatus(orderId) {
        try {
            const response = await fetch('/api/order/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.config.apiKey,
                    apiSecret: this.config.apiSecret,
                    symbol: this.config.symbol,
                    orderId
                })
            });
            const data = await response.json();
            if (data.success && data.data?.list?.length > 0) {
                const order = data.data.list[0];
                return {
                    filled: order.orderStatus === 'FILLED',
                    partiallyFilled: order.orderStatus === 'PARTIALLY_FILLED',
                    filledQty: parseFloat(order.cumExecQty || 0)
                };
            }
            return { filled: false, partiallyFilled: false, filledQty: 0 };
        } catch {
            return { filled: false, partiallyFilled: false, filledQty: 0 };
        }
    }

    async cancelOrder(orderId) {
        try {
            const response = await fetch('/api/order/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: this.config.apiKey,
                    apiSecret: this.config.apiSecret,
                    symbol: this.config.symbol,
                    orderId
                })
            });
            const data = await response.json();
            if (data.success) this.log(`Order ${orderId} canceled`, 'info');
            return data.success;
        } catch (error) {
            this.log(`Cancel error: ${error.message}`, 'error');
            return false;
        }
    }

    updateStatus(status) {
        const statusEl = document.getElementById('scalpStatus');
        
        if (['running', 'paused', 'stopping', 'waiting_market_sell'].includes(status)) {
            statusEl.classList.add('running');
            
            const estimatedProfit = this.calculateEstimatedProfit();
            const avgBuyPrice = this.calculateAvgBuyPrice();
            const totalPendingQty = this.calculateTotalPendingQty();
            
            const formatPrice = p => p > 0 ? p.toFixed(6) : '-';
            const formatProfit = p => (p >= 0 ? '+' : '') + p.toFixed(6);
            
            let statusText = 'Bot Running', statusColor = '#00d4aa', statusColor2 = '#00b894';
            if (status === 'paused') { statusText = 'Bot Paused'; statusColor = '#8b5cf6'; statusColor2 = '#7c3aed'; }
            else if (status === 'stopping') { statusText = 'Stopping...'; statusColor = '#f59e0b'; statusColor2 = '#d97706'; }
            else if (status === 'waiting_market_sell') { statusText = '⏳ Waiting Market Sell'; statusColor = '#ef4444'; statusColor2 = '#dc2626'; }
            
            const buyOrdersStopped = status === 'paused' || status === 'waiting_market_sell';
            
            statusEl.innerHTML = `
                <div class="status-running">
                    <div class="status-header-main" style="background: linear-gradient(135deg, ${statusColor}, ${statusColor2});">
                        <span class="status-dot" style="${buyOrdersStopped ? 'animation: none; background: #fbbf24;' : ''}"></span>
                        <span class="status-text">${statusText}</span>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-card buy-stats"><div class="stat-icon">📥</div><div class="stat-content"><div class="stat-label">Buy Orders</div><div class="stat-value">${this.stats.totalBuyOrdersFilled} <span class="stat-total">/ ${this.stats.totalBuyOrdersCreated}</span></div></div></div>
                        <div class="stat-card sell-stats"><div class="stat-icon">📤</div><div class="stat-content"><div class="stat-label">Sell Orders</div><div class="stat-value">${this.stats.totalSellOrdersFilled} <span class="stat-total">/ ${this.stats.totalSellOrdersCreated}</span></div></div></div>
                        <div class="stat-card profit-estimated"><div class="stat-icon">📊</div><div class="stat-content"><div class="stat-label">Est. Profit</div><div class="stat-value ${estimatedProfit >= 0 ? 'positive' : 'negative'}">${formatProfit(estimatedProfit)} USDT</div></div></div>
                        <div class="stat-card profit-real"><div class="stat-icon">💰</div><div class="stat-content"><div class="stat-label">Real Profit</div><div class="stat-value ${this.stats.realProfit >= 0 ? 'positive' : 'negative'}">${formatProfit(this.stats.realProfit)} USDT</div></div></div>
                        <div class="stat-card avg-price"><div class="stat-icon">⚖️</div><div class="stat-content"><div class="stat-label">Avg Buy Price</div><div class="stat-value">${formatPrice(avgBuyPrice)}</div><div class="stat-detail">Qty: ${totalPendingQty.toFixed(4)}</div></div></div>
                        <div class="stat-card active-orders"><div class="stat-icon">📋</div><div class="stat-content"><div class="stat-label">Active Orders</div><div class="stat-value">${this.activeBuyOrders.length + this.activeSellTPOrders.length}</div><div class="stat-detail">Buy: ${this.activeBuyOrders.length} | TP: ${this.activeSellTPOrders.length}</div></div></div>
                    </div>
                    <div class="orders-section">
                        <div class="orders-panel" style="${buyOrdersStopped ? 'opacity: 0.5;' : ''}">
                            <div class="panel-header"><span class="panel-icon">${buyOrdersStopped ? '🛑' : '🟢'}</span><span class="panel-title">Buy Orders (${this.activeBuyOrders.length}/${this.config.maxBuyOrders})</span></div>
                            <div class="orders-list">${this.activeBuyOrders.length > 0 ? this.activeBuyOrders.map(o => `<div class="order-item buy-order"><span class="order-layer">L${o.layer}</span><span class="order-price">${o.price.toFixed(6)}</span><span class="order-qty">${o.qty}</span><span class="order-age">${Math.floor((Date.now() - o.timestamp) / 1000)}s</span></div>`).join('') : '<div class="no-orders">No active buy orders</div>'}</div>
                        </div>
                        <div class="orders-panel">
                            <div class="panel-header"><span class="panel-icon">🔵</span><span class="panel-title">TP Orders (${this.activeSellTPOrders.length}/${this.config.maxSellTPOrders})</span></div>
                            <div class="orders-list">${this.activeSellTPOrders.length > 0 ? this.activeSellTPOrders.map(o => `<div class="order-item tp-order"><span class="order-price">${o.price.toFixed(6)}</span><span class="order-qty">${o.qty}</span><span class="order-profit">+${((o.price - o.buyPrice) * o.qty).toFixed(6)}</span></div>`).join('') : '<div class="no-orders">No active TP orders</div>'}</div>
                        </div>
                    </div>
                </div>`;
        } else {
            statusEl.classList.remove('running');
            statusEl.innerHTML = `
                <div class="status-stopped">
                    <div class="status-header-main stopped"><span class="status-dot stopped"></span><span class="status-text">Bot Stopped</span></div>
                    <div class="final-stats">
                        <div class="final-stat"><span class="final-label">Buy Orders:</span><span class="final-value">${this.stats.totalBuyOrdersFilled} / ${this.stats.totalBuyOrdersCreated}</span></div>
                        <div class="final-stat"><span class="final-label">Sell Orders:</span><span class="final-value">${this.stats.totalSellOrdersFilled} / ${this.stats.totalSellOrdersCreated}</span></div>
                        <div class="final-stat"><span class="final-label">Real Profit:</span><span class="final-value ${this.stats.realProfit >= 0 ? 'positive' : 'negative'}">${this.stats.realProfit >= 0 ? '+' : ''}${this.stats.realProfit.toFixed(6)} USDT</span></div>
                    </div>
                </div>`;
        }
    }

    log(message, type = 'info') {
        const logsContent = document.getElementById('logsContent');
        const timestamp = new Date().toLocaleTimeString();
        const logItem = document.createElement('div');
        logItem.className = `log-item ${type}`;
        logItem.textContent = `[${timestamp}] ${message}`;
        logsContent.insertBefore(logItem, logsContent.firstChild);
        while (logsContent.children.length > 100) logsContent.removeChild(logsContent.lastChild);
    }
}

const scalpingBot = new ScalpingBot();

document.addEventListener('DOMContentLoaded', function() {
    const startBtn = document.getElementById('startScalpBtn');
    const stopBtn = document.getElementById('stopScalpBtn');
    const pauseBtn = document.getElementById('pauseScalpBtn');
    const resumeBtn = document.getElementById('resumeScalpBtn');
    const testOrderBtn = document.getElementById('testOrderBtn');
    const clearStatsBtn = document.getElementById('clearStatsBtn');

    const updateClearStatsBtn = () => { if (clearStatsBtn) clearStatsBtn.disabled = scalpingBot.isRunning || scalpingBot.isPaused; };
    const resetButtonStates = () => { startBtn.style.display = 'block'; stopBtn.style.display = 'none'; pauseBtn.style.display = 'none'; resumeBtn.style.display = 'none'; updateClearStatsBtn(); };

    startBtn?.addEventListener('click', async () => {
        const config = getScalpingConfig();
        if (!validateConfig(config)) return;
        scalpingBot.resetStats();
        scalpingBot.init(config);
        await scalpingBot.start();
        startBtn.style.display = 'none'; pauseBtn.style.display = 'block'; stopBtn.style.display = 'block';
        updateClearStatsBtn();
    });

    stopBtn?.addEventListener('click', async () => {
        stopBtn.disabled = pauseBtn.disabled = resumeBtn.disabled = true;
        await scalpingBot.stop();
        stopBtn.disabled = pauseBtn.disabled = resumeBtn.disabled = false;
        resetButtonStates();
    });

    pauseBtn?.addEventListener('click', async () => { await scalpingBot.pause(); pauseBtn.style.display = 'none'; resumeBtn.style.display = 'block'; updateClearStatsBtn(); });
    resumeBtn?.addEventListener('click', async () => { await scalpingBot.resume(); resumeBtn.style.display = 'none'; pauseBtn.style.display = 'block'; updateClearStatsBtn(); });
    clearStatsBtn?.addEventListener('click', () => { if (!scalpingBot.isRunning && !scalpingBot.isPaused) { scalpingBot.resetStats(); scalpingBot.updateStatus('stopped'); scalpingBot.log('🗑️ Stats cleared', 'info'); } });
    testOrderBtn?.addEventListener('click', async () => { const config = getScalpingConfig(); if (validateConfig(config)) { scalpingBot.init(config); await scalpingBot.testSingleOrder(); } });
});

function getScalpingConfig() {
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
        sellAllOnStop: document.getElementById('scalpSellAllOnStop')?.checked || false
    };
}

function validateConfig(config) {
    if (!config.apiKey || !config.apiSecret) { alert('Please enter API Key and Secret'); return false; }
    if (!config.symbol) { alert('Please enter Trading Symbol'); return false; }
    if (config.orderQty <= 0) { alert('Order Quantity must be > 0'); return false; }
    return true;
}
