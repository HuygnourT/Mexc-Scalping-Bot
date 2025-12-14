const mexcService = require('./mexcService');

class ScalpingBot {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.config = {};
    this.activeBuyOrders = [];
    this.activeSellTPOrders = [];
    this.loopInterval = null;
    this.lastBuyFillTime = 0;
    this.isWaitingForMarketSell = false;
    this.pendingMarketSell = null;
    this.pendingNewTP = null;
    this.logs = [];
    this.startTime = null;
    this.endTime = null;
    this.runHistory = [];  // Store all session history
    this.loopCount = 0;
    this.stats = {
      totalBuyOrdersCreated: 0,
      totalBuyOrdersFilled: 0,
      totalBuyOrdersCanceled: 0,
      totalSellOrdersCreated: 0,
      totalSellOrdersFilled: 0,
      totalSellOrdersCanceled: 0,
      realProfit: 0,
      marketSellProfit: 0,  // Track market sell profit separately
      totalFees: 0,
      pendingPositions: []
    };
  }

  init(config) {
    this.config = config;
    this.resetStats();
    this.log('Bot initialized with config', 'info');
    this.log(`Symbol: ${config.symbol}, Tick Size: ${config.tickSize}`, 'info');
  }

  // Update config while running
  updateConfig(newConfig) {
    const oldConfig = { ...this.config };
    
    // Update allowed parameters (not apiKey/apiSecret/symbol while running)
    this.config.tickSize = newConfig.tickSize;
    this.config.maxBuyOrders = newConfig.maxBuyOrders;
    this.config.offsetTicks = newConfig.offsetTicks;
    this.config.layerStepTicks = newConfig.layerStepTicks;
    this.config.buyTTL = newConfig.buyTTL;
    this.config.repriceTicks = newConfig.repriceTicks;
    this.config.tpTicks = newConfig.tpTicks;
    this.config.maxSellTPOrders = newConfig.maxSellTPOrders;
    this.config.orderQty = newConfig.orderQty;
    this.config.loopInterval = newConfig.loopInterval;
    this.config.waitAfterBuyFill = newConfig.waitAfterBuyFill;
    this.config.sellAllOnStop = newConfig.sellAllOnStop;
    
    this.log('⚙️ Configuration updated while running', 'warning');
    
    // Log only changed values
    if (oldConfig.tickSize !== this.config.tickSize) {
      this.log(`Tick Size: ${oldConfig.tickSize} → ${this.config.tickSize}`, 'info');
    }
    if (oldConfig.maxBuyOrders !== this.config.maxBuyOrders) {
      this.log(`Max Buy Orders: ${oldConfig.maxBuyOrders} → ${this.config.maxBuyOrders}`, 'info');
    }
    if (oldConfig.offsetTicks !== this.config.offsetTicks) {
      this.log(`Offset Ticks: ${oldConfig.offsetTicks} → ${this.config.offsetTicks}`, 'info');
    }
    if (oldConfig.layerStepTicks !== this.config.layerStepTicks) {
      this.log(`Layer Step Ticks: ${oldConfig.layerStepTicks} → ${this.config.layerStepTicks}`, 'info');
    }
    if (oldConfig.buyTTL !== this.config.buyTTL) {
      this.log(`Buy TTL: ${oldConfig.buyTTL}s → ${this.config.buyTTL}s`, 'info');
    }
    if (oldConfig.repriceTicks !== this.config.repriceTicks) {
      this.log(`Reprice Ticks: ${oldConfig.repriceTicks} → ${this.config.repriceTicks}`, 'info');
    }
    if (oldConfig.tpTicks !== this.config.tpTicks) {
      this.log(`TP Ticks: ${oldConfig.tpTicks} → ${this.config.tpTicks} (only new TPs)`, 'info');
    }
    if (oldConfig.maxSellTPOrders !== this.config.maxSellTPOrders) {
      this.log(`Max TP Orders: ${oldConfig.maxSellTPOrders} → ${this.config.maxSellTPOrders}`, 'info');
    }
    if (oldConfig.orderQty !== this.config.orderQty) {
      this.log(`Order Qty: ${oldConfig.orderQty} → ${this.config.orderQty}`, 'info');
    }
    if (oldConfig.loopInterval !== this.config.loopInterval) {
      this.log(`Loop Interval: ${oldConfig.loopInterval}ms → ${this.config.loopInterval}ms`, 'info');
    }
    if (oldConfig.waitAfterBuyFill !== this.config.waitAfterBuyFill) {
      this.log(`Wait After Fill: ${oldConfig.waitAfterBuyFill}ms → ${this.config.waitAfterBuyFill}ms`, 'info');
    }
    if (oldConfig.sellAllOnStop !== this.config.sellAllOnStop) {
      this.log(`Sell All On Stop: ${oldConfig.sellAllOnStop} → ${this.config.sellAllOnStop}`, 'info');
    }
    
    return { success: true, message: 'Configuration updated' };
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
      marketSellProfit: 0,
      totalFees: 0,
      pendingPositions: []
    };
    this.logs = [];
    this.loopCount = 0;
    this.consecutiveErrors = 0;
    this.isWaitingForMarketSell = false;
    this.pendingMarketSell = null;
    this.pendingNewTP = null;
    this.startTime = null;
    this.endTime = null;
    this.lastBuyFillTime = 0;  // Reset lastBuyFillTime
    this.activeBuyOrders = [];
    this.activeSellTPOrders = [];
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isWaitingForMarketSell: this.isWaitingForMarketSell,
      stats: this.stats,
      activeBuyOrders: this.activeBuyOrders,
      activeSellTPOrders: this.activeSellTPOrders,
      logs: this.logs.slice(-50),
      config: this.config,
      estimatedProfit: this.calculateEstimatedProfit(),
      avgBuyPrice: this.calculateAvgBuyPrice(),
      totalPendingQty: this.calculateTotalPendingQty(),
      startTime: this.startTime,
      endTime: this.endTime,
      runHistory: this.runHistory
    };
  }

  getRunHistory() {
    return this.runHistory;
  }

  clearHistory() {
    this.runHistory = [];
    return { success: true, message: 'History cleared' };
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
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

  async loadExistingSellOrders() {
    this.log('📥 Loading existing sell orders from MEXC...', 'info');
    
    try {
      const result = await mexcService.getOpenOrders({
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
        symbol: this.config.symbol
      });

      if (!result.success) {
        this.log(`❌ Failed to load existing orders: ${result.message}`, 'error');
        return { success: false, message: result.message };
      }

      const openOrders = result.data || [];
      
      // Filter only SELL orders with LIMIT type (these are our TP orders)
      const sellOrders = openOrders.filter(order => 
        order.side === 'SELL' && order.type === 'LIMIT'
      );

      if (sellOrders.length === 0) {
        this.log('ℹ️ No existing sell orders found', 'info');
        return { success: true, count: 0 };
      }

      this.log(`📋 Found ${sellOrders.length} existing sell order(s)`, 'info');

      // Get current orderbook to estimate buy price (we don't know exact buy price)
      const orderbook = await this.fetchOrderbook();
      const currentBid = orderbook ? orderbook.bestBid : 0;

      for (const order of sellOrders) {
        const sellPrice = parseFloat(order.price);
        const qty = parseFloat(order.origQty) - parseFloat(order.executedQty || 0);
        
        if (qty <= 0) continue; // Skip fully filled orders

        // Estimate buy price: sellPrice - (tpTicks * tickSize)
        // This is an approximation since we don't know the actual buy price
        const estimatedBuyPrice = this.roundToTick(sellPrice - (this.config.tpTicks * this.config.tickSize));
        
        // Add to active sell TP orders
        this.activeSellTPOrders.push({
          orderId: order.orderId,
          price: sellPrice,
          qty: qty,
          buyPrice: estimatedBuyPrice,  // Estimated - not exact
          timestamp: order.time || Date.now(),
          isExisting: true  // Mark as loaded from exchange
        });

        // Also add to pending positions
        this.stats.pendingPositions.push({
          orderId: order.orderId,
          buyPrice: estimatedBuyPrice,
          qty: qty,
          sellPrice: sellPrice
        });

        this.log(`✅ Loaded SELL order: ${order.orderId} @ ${sellPrice} qty: ${qty}`, 'success');
      }

      this.log(`📊 Total active TP orders after loading: ${this.activeSellTPOrders.length}`, 'info');
      
      return { success: true, count: sellOrders.length };

    } catch (error) {
      this.log(`❌ Error loading existing orders: ${error.message}`, 'error');
      return { success: false, message: error.message };
    }
  }

  async start() {
    if (this.isRunning) {
      this.log('Bot is already running', 'warning');
      return { success: false, message: 'Bot is already running' };
    }
    this.isRunning = true;
    this.isPaused = false;
    this.startTime = new Date().toISOString();
    this.endTime = null;
    this.log('🚀 Bot started', 'success');
    
    // Load existing sell orders before starting the main loop
    const loadResult = await this.loadExistingSellOrders();
    if (loadResult.count > 0) {
      this.log(`📥 Loaded ${loadResult.count} existing sell order(s) from MEXC`, 'success');
    }
    
    this.runMainLoop();
    return { success: true, message: 'Bot started' };
  }

  async stop() {
    if (!this.isRunning) {
      return { success: false, message: 'Bot is not running' };
    }
    this.isRunning = false;
    this.isPaused = false;
    
    if (this.loopInterval) {
      clearTimeout(this.loopInterval);
      this.loopInterval = null;
    }
    
    this.log('⏹️ Stopping bot...', 'warning');

    for (const order of this.activeBuyOrders) {
      await this.cancelOrder(order.orderId);
      this.stats.totalBuyOrdersCanceled++;
    }
    this.activeBuyOrders = [];

    // Track market sell profit separately
    this.stats.marketSellProfit = 0;
    
    if (this.config.sellAllOnStop && this.activeSellTPOrders.length > 0) {
      this.log('💰 Sell All On Stop - Selling at market...', 'warning');
      await this.sellAllAtMarket();
    }

    this.endTime = new Date().toISOString();
    this.log('⏹️ Bot stopped', 'warning');
    
    // Save to run history
    const runDuration = new Date(this.endTime) - new Date(this.startTime);
    const historyEntry = {
      id: Date.now(),
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.formatDuration(runDuration),
      durationMs: runDuration,
      symbol: this.config.symbol,
      totalBuyFilled: this.stats.totalBuyOrdersFilled,
      totalSellFilled: this.stats.totalSellOrdersFilled,
      realProfit: this.stats.realProfit,
      marketSellProfit: this.stats.marketSellProfit,
      totalProfit: this.stats.realProfit,
      config: {
        tickSize: this.config.tickSize,
        orderQty: this.config.orderQty,
        tpTicks: this.config.tpTicks,
        maxBuyOrders: this.config.maxBuyOrders
      }
    };
    
    this.runHistory.unshift(historyEntry);  // Add to beginning
    
    // Keep only last 50 entries
    if (this.runHistory.length > 50) {
      this.runHistory = this.runHistory.slice(0, 50);
    }
    
    return { success: true, message: 'Bot stopped', history: historyEntry };
  }

  async pause() {
    if (!this.isRunning || this.isPaused) {
      return { success: false, message: 'Cannot pause' };
    }
    this.isPaused = true;
    this.log('⏸️ Pausing - Canceling buy orders, keeping TP...', 'warning');

    for (const order of this.activeBuyOrders) {
      await this.cancelOrder(order.orderId);
      this.stats.totalBuyOrdersCanceled++;
    }
    this.activeBuyOrders = [];
    this.log(`⏸️ Paused. ${this.activeSellTPOrders.length} TP orders active.`, 'warning');
    return { success: true, message: 'Bot paused' };
  }

  async resume() {
    if (!this.isRunning || !this.isPaused) {
      return { success: false, message: 'Cannot resume' };
    }
    this.isPaused = false;
    this.log('▶️ Resumed - Creating new buy orders...', 'success');
    return { success: true, message: 'Bot resumed' };
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
          await this.sleep(2000);
          continue;
        }

        const bestBid = orderbook.bestBid;
        this.log(`Best Bid: ${bestBid}`, 'info');

        let buyPrice = this.roundToTick(bestBid + (this.config.offsetTicks * this.config.tickSize));
        this.log(`Placing BUY order at ${buyPrice} for ${this.config.orderQty}...`, 'info');
        
        currentOrderId = await this.placeLimitOrder('Buy', buyPrice, this.config.orderQty);
        if (!currentOrderId) {
          this.log('❌ Failed to place buy order, retrying...', 'error');
          await this.sleep(2000);
          continue;
        }

        this.stats.totalBuyOrdersCreated++;
        this.log(`✅ Buy order placed: ${currentOrderId}`, 'success');

        const checkInterval = 2000;
        const maxAttempts = Math.ceil((this.config.buyTTL * 1000) / checkInterval);
        let attempts = 0;
        let shouldReprice = false;

        while (attempts < maxAttempts && !orderFilled && !shouldReprice) {
          await this.sleep(checkInterval);
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
          
          const status = await this.checkOrderStatusAPI(currentOrderId);
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
          await this.sleep(1000);
        }
      }

      if (!orderFilled) {
        this.log(`❌ Test ended: Order not filled after ${repricingAttempts} attempts`, 'error');
      }
      return { success: orderFilled, message: orderFilled ? 'Test order filled' : 'Test order not filled' };
    } catch (error) {
      this.log(`Test error: ${error.message}`, 'error');
      if (currentOrderId) {
        await this.cancelOrder(currentOrderId);
        this.stats.totalBuyOrdersCanceled++;
      }
      return { success: false, message: error.message };
    }
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
          this.stats.marketSellProfit += profitLoss;  // Track separately
          this.stats.totalSellOrdersFilled++;
          this.log(`💰 Market sold ${order.qty} @ ~${bestBid}, P/L: ${profitLoss.toFixed(6)} USDT`, profitLoss >= 0 ? 'success' : 'error');
        }
      } catch (error) {
        this.log(`Error selling: ${error.message}`, 'error');
      }
    }
    this.activeSellTPOrders = [];
    this.stats.pendingPositions = [];
  }

  async cancelAllTPOrders() {
    for (const order of this.activeSellTPOrders) {
      await this.cancelOrder(order.orderId);
      this.stats.totalSellOrdersCanceled++;
    }
    this.activeSellTPOrders = [];
    this.stats.pendingPositions = [];
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

    if (this.isRunning) {
      this.loopInterval = setTimeout(() => this.runMainLoop(), this.config.loopInterval);
    }
  }

  async fetchOrderbook() {
    try {
      const result = await mexcService.getOrderbook({ symbol: this.config.symbol });
      if (result.success && result.data) {
        return {
          bestBid: parseFloat(result.data.bestBid),
          bestAsk: parseFloat(result.data.bestAsk)
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
      const status = await this.checkOrderStatusAPI(order.orderId);

      if (status.filled) {
        this.log(`✅ Buy ${order.orderId} filled at ${order.price}`, 'success');
        this.stats.totalBuyOrdersFilled++;
        this.lastBuyFillTime = Date.now();
        await this.createSellTPOrder(order.price, order.qty);
        ordersToRemove.push(i);
        continue;
      }

      // Check TTL expiry
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

    // Check if TP orders reached maximum - stop creating new buys
    if (this.activeBuyOrders.length + this.activeSellTPOrders.length >= this.config.maxSellTPOrders) {
      this.log(`🛑 MAX TP REACHED (${this.activeSellTPOrders.length}/${this.config.maxSellTPOrders}) - Not creating new buys`, 'warning');
      return;
    }

    // Check wait after buy fill
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
    
    const status = await this.checkOrderStatusAPI(this.pendingMarketSell.orderId);
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
      const status = await this.checkOrderStatusAPI(order.orderId);
      
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
      const result = await mexcService.createOrder({
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
        symbol: this.config.symbol,
        side: side,
        orderType: 'Limit',
        qty: qty.toString(),
        price: price.toString()
      });
      if (result.success) return result.data.orderId;
      this.log(`Order failed: ${result.message}`, 'error');
      return null;
    } catch (error) {
      this.log(`Order error: ${error.message}`, 'error');
      return null;
    }
  }

  async placeMarketOrder(side, qty) {
    try {
      const result = await mexcService.createOrder({
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
        symbol: this.config.symbol,
        side: side,
        orderType: 'Market',
        qty: qty.toString()
      });
      return result.success ? result.data.orderId : null;
    } catch (error) {
      this.log(`Market order error: ${error.message}`, 'error');
      return null;
    }
  }

  async checkOrderStatusAPI(orderId) {
    try {
      const result = await mexcService.getOrderStatus({
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
        symbol: this.config.symbol,
        orderId: orderId
      });
      if (result.success && result.data?.list?.length > 0) {
        const order = result.data.list[0];
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
      const result = await mexcService.cancelOrder({
        apiKey: this.config.apiKey,
        apiSecret: this.config.apiSecret,
        symbol: this.config.symbol,
        orderId: orderId
      });
      if (result.success) this.log(`Order ${orderId} canceled`, 'info');
      return result.success;
    } catch (error) {
      this.log(`Cancel error: ${error.message}`, 'error');
      return false;
    }
  }

  roundToTick(price) {
    const tickSize = this.config.tickSize;
    const tickStr = tickSize.toString();
    const decimals = tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
    return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(decimals));
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    this.logs.push({ timestamp, message, type });
    if (this.logs.length > 200) this.logs.shift();
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ScalpingBot;
