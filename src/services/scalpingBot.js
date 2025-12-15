const mexcService = require('./mexcService');
const mexcWebSocket = require('./mexcWebSocket');

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
    this.runHistory = [];
    this.loopCount = 0;
    this.wsConnected = false;
    
    // Queue for pending TP orders to create
    this.pendingTPQueue = [];
    this.isProcessingTPQueue = false;
    
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
  }

  init(config) {
    this.config = config;
    this.resetStats();
    this.log('Bot initialized with config', 'info');
    this.log(`Symbol: ${config.symbol}, Tick Size: ${config.tickSize}`, 'info');
  }

  updateConfig(newConfig) {
    const oldConfig = { ...this.config };
    
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
    
    this.log('⚙️ Configuration updated', 'warning');
    
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
    this.lastBuyFillTime = 0;
    this.isWaitingForMarketSell = false;
    this.pendingMarketSell = null;
    this.pendingNewTP = null;
    this.startTime = null;
    this.endTime = null;
    this.activeBuyOrders = [];
    this.activeSellTPOrders = [];
    this.pendingTPQueue = [];
    this.isProcessingTPQueue = false;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isWaitingForMarketSell: this.isWaitingForMarketSell,
      wsConnected: this.wsConnected,
      pendingTPQueueSize: this.pendingTPQueue.length,
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

  // ============== WebSocket Setup ==============
  
  setupWebSocket() {
    mexcWebSocket.setCredentials(this.config.apiKey, this.config.apiSecret);
    
    // Handle order updates (FILLED, CANCELED, etc.)
    mexcWebSocket.onOrderUpdate = (orderData) => {
      this.handleWebSocketOrderUpdate(orderData);
    };

    // Handle deal/trade updates
    mexcWebSocket.onDealUpdate = (dealData) => {
      this.handleWebSocketDealUpdate(dealData);
    };

    mexcWebSocket.onConnect = () => {
      this.wsConnected = true;
      this.log('🔌 WebSocket connected - Real-time updates enabled', 'success');
    };

    mexcWebSocket.onDisconnect = () => {
      this.wsConnected = false;
      this.log('🔌 WebSocket disconnected - Will reconnect...', 'warning');
    };

    mexcWebSocket.onError = (error) => {
      this.log(`🔌 WebSocket error: ${error.message}`, 'error');
    };
  }

  // Helper: Find order by orderId or clientOrderId
  findOrderIndex(orderList, orderData) {
    // Try exact match first
    let idx = orderList.findIndex(o => o.orderId === orderData.orderId);
    
    // Try matching with clientOrderId
    if (idx === -1 && orderData.clientOrderId) {
      idx = orderList.findIndex(o => o.orderId === orderData.clientOrderId);
    }
    
    // Try matching by removing prefix (C02__ etc)
    if (idx === -1 && orderData.clientOrderId && orderData.clientOrderId.includes('__')) {
      const extractedId = orderData.clientOrderId.split('__')[1];
      idx = orderList.findIndex(o => o.orderId === extractedId || o.orderId.includes(extractedId));
    }
    
    // Try reverse: our stored orderId might have prefix, WS orderId doesn't
    if (idx === -1) {
      idx = orderList.findIndex(o => {
        if (o.orderId.includes('__')) {
          return o.orderId.split('__')[1] === orderData.orderId;
        }
        return false;
      });
    }

    return idx;
  }

  handleWebSocketOrderUpdate(orderData) {
    // Only process orders for our symbol
    if (orderData.symbol !== this.config.symbol) return;

    // Only handle SELL orders (TP orders) via WebSocket
    // BUY orders are handled via polling in checkBuyOrdersStatus()
    
    // SELL order update (TP orders)
    if (orderData.tradeType === 2) {
      this.log(`[WS] SELL update: orderId=${orderData.orderId}, clientOrderId=${orderData.clientOrderId}, status=${orderData.status}`, 'info');
      
      const idx = this.findOrderIndex(this.activeSellTPOrders, orderData);
      
      this.log(`[WS] Matching against ${this.activeSellTPOrders.length} TP orders, Found index: ${idx}`, 'info');
      
      if (idx !== -1) {
        if (orderData.status === 2) {  // FILLED
          const order = this.activeSellTPOrders[idx];
          const profit = (order.price - order.buyPrice) * order.qty;
          
          this.stats.totalSellOrdersFilled++;
          this.stats.realProfit += profit;
          
          // Remove from pending positions
          const posIdx = this.stats.pendingPositions.findIndex(p => p.orderId === order.orderId);
          if (posIdx !== -1) this.stats.pendingPositions.splice(posIdx, 1);
          
          this.activeSellTPOrders.splice(idx, 1);
          this.log(`💰 [WS] TP FILLED! Price: ${order.price}, Profit: ${profit.toFixed(6)} USDT`, 'success');
        }
        else if (orderData.status === 4) {  // CANCELED
          this.activeSellTPOrders.splice(idx, 1);
          this.log(`[WS] TP order canceled: ${orderData.orderId}`, 'info');
        }
      } else {
        // Log stored orderIds for debugging
        const storedIds = this.activeSellTPOrders.map(o => o.orderId).join(', ');
        this.log(`[WS] ⚠️ SELL order NOT FOUND. Looking for: ${orderData.orderId}. Stored: ${storedIds}`, 'warning');
      }
    }
    
    // Ignore BUY order updates from WebSocket - handled by polling
  }

  handleWebSocketDealUpdate(dealData) {
    // Log deals for transparency
    if (dealData.symbol !== this.config.symbol) return;
    
    const side = dealData.tradeType === 1 ? 'BUY' : 'SELL';
    this.log(`📊 [WS] Deal: ${side} ${dealData.quantity} @ ${dealData.price}`, 'info');
  }

  // ============== Load Existing Orders ==============

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
      const sellOrders = openOrders.filter(order => 
        order.side === 'SELL' && order.type === 'LIMIT'
      );

      if (sellOrders.length === 0) {
        this.log('ℹ️ No existing sell orders found', 'info');
        return { success: true, count: 0 };
      }

      this.log(`📋 Found ${sellOrders.length} existing sell order(s)`, 'info');

      for (const order of sellOrders) {
        const sellPrice = parseFloat(order.price);
        const qty = parseFloat(order.origQty) - parseFloat(order.executedQty || 0);
        
        if (qty <= 0) continue;

        const estimatedBuyPrice = this.roundToTick(sellPrice - (this.config.tpTicks * this.config.tickSize));
        
        this.activeSellTPOrders.push({
          orderId: order.orderId,
          price: sellPrice,
          qty: qty,
          buyPrice: estimatedBuyPrice,
          timestamp: order.time || Date.now(),
          isExisting: true
        });

        this.stats.pendingPositions.push({
          orderId: order.orderId,
          buyPrice: estimatedBuyPrice,
          qty: qty,
          sellPrice: sellPrice
        });

        this.log(`✅ Loaded SELL order: ${order.orderId} @ ${sellPrice} qty: ${qty}`, 'success');
      }

      return { success: true, count: sellOrders.length };

    } catch (error) {
      this.log(`❌ Error loading existing orders: ${error.message}`, 'error');
      return { success: false, message: error.message };
    }
  }

  // ============== Bot Control ==============

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
    
    // Setup and connect WebSocket
    this.setupWebSocket();
    try {
      await mexcWebSocket.connect();
    } catch (error) {
      this.log(`⚠️ WebSocket connection failed, using polling fallback: ${error.message}`, 'warning');
    }
    
    // Load existing sell orders
    const loadResult = await this.loadExistingSellOrders();
    if (loadResult.count > 0) {
      this.log(`📥 Loaded ${loadResult.count} existing sell order(s)`, 'success');
    }
    
    // Start main loop (now only for placing orders & repricing)
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
    
    // Disconnect WebSocket
    mexcWebSocket.disconnect();
    this.wsConnected = false;
    
    this.log('⏹️ Stopping bot...', 'warning');

    // Cancel all buy orders
    for (const order of this.activeBuyOrders) {
      await this.cancelOrder(order.orderId);
      this.stats.totalBuyOrdersCanceled++;
    }
    this.activeBuyOrders = [];

    this.stats.marketSellProfit = 0;
    
    if (this.config.sellAllOnStop && this.activeSellTPOrders.length > 0) {
      this.log('💰 Sell All On Stop - Selling at market...', 'warning');
      await this.sellAllAtMarket();
    }

    this.endTime = new Date().toISOString();
    this.log('⏹️ Bot stopped', 'warning');
    
    // Save to history
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
    
    this.runHistory.unshift(historyEntry);
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

  // ============== Main Loop ==============

  async runMainLoop() {
    if (!this.isRunning) return;

    try {
      const orderbook = await this.fetchOrderbook();
      
      if (orderbook) {
        this.loopCount++;
        
        // Log orderbook less frequently (every 5 loops)
        if (this.loopCount % 5 === 0) {
          this.log(`Orderbook: Bid=${orderbook.bestBid}, Ask=${orderbook.bestAsk}`, 'info');

          // Fallback: Poll TP orders periodically (every 5 loops) even if WS connected
          // This ensures we don't miss any fills
          await this.pollTPOrderStatus();
          this.loopCount = 0;
        }

        if (!this.isPaused && !this.isWaitingForMarketSell) {
          // Check buy order status via polling (old logic)
          await this.checkBuyOrdersStatus();
          
          // Check TTL and reprice buy orders
          await this.manageBuyOrders(orderbook.bestBid);
          
          // Create new buy orders if needed
          await this.createBuyOrders(orderbook.bestBid);
        }
      }
      
    } catch (error) {
      this.log(`Loop error: ${error.message}`, 'error');
    }

    if (this.isRunning) {
      this.loopInterval = setTimeout(() => this.runMainLoop(), this.config.loopInterval);
    }
  }

  // Check buy order status via API (old logic)
  async checkBuyOrdersStatus() {
    for (let i = this.activeBuyOrders.length - 1; i >= 0; i--) {
      const order = this.activeBuyOrders[i];
      const status = await this.checkOrderStatusAPI(order.orderId);
      
      if (status.filled) {
        this.stats.totalBuyOrdersFilled++;
        this.lastBuyFillTime = Date.now();
        this.activeBuyOrders.splice(i, 1);
        
        this.log(`✅ BUY FILLED at ${order.price}`, 'success');
        
        // Create TP order using queue
        this.addToTPQueue(order.price, order.qty);
      } 
      else if (status.partiallyFilled && status.filledQty > order.filledQty) {
        this.activeBuyOrders[i].filledQty = status.filledQty;
        this.log(`BUY partially filled: ${status.filledQty}/${order.qty}`, 'info');
      }
    }
  }

  // Manage buy orders (TTL, repricing) - NO status polling
  async manageBuyOrders(bestBid) {
    const now = Date.now();
    const ordersToCancel = [];

    for (let i = 0; i < this.activeBuyOrders.length; i++) {
      const order = this.activeBuyOrders[i];
      const age = (now - order.timestamp) / 1000;

      // Check TTL expiry
      if (age >= this.config.buyTTL) {
        this.log(`Order ${order.orderId} TTL expired (${age.toFixed(0)}s)`, 'warning');
        ordersToCancel.push({ index: i, order, reason: 'ttl' });
        continue;
      }

      // Check if repricing needed
      const tickDiff = Math.abs(order.price - bestBid) / this.config.tickSize;
      if (tickDiff >= this.config.repriceTicks) {
        this.log(`Repricing ${order.orderId} (${tickDiff.toFixed(1)} ticks away)`, 'info');
        ordersToCancel.push({ index: i, order, reason: 'reprice' });
      }
    }

    // Cancel orders (WebSocket will notify us when done)
    for (let i = ordersToCancel.length - 1; i >= 0; i--) {
      const { index, order } = ordersToCancel[i];
      await this.cancelOrder(order.orderId);
      this.stats.totalBuyOrdersCanceled++;
      this.activeBuyOrders.splice(index, 1);
    }
  }

  // Fallback polling for TP orders - runs periodically as backup
  async pollTPOrderStatus() {
    if (this.activeSellTPOrders.length === 0) return;
    
    this.log(`[Poll] Checking ${this.activeSellTPOrders.length} TP orders...`, 'info');
    
    for (let i = this.activeSellTPOrders.length - 1; i >= 0; i--) {
      const order = this.activeSellTPOrders[i];
      const status = await this.checkOrderStatusAPI(order.orderId);
      
      if (status.filled) {
        const profit = (order.price - order.buyPrice) * order.qty;
        this.stats.totalSellOrdersFilled++;
        this.stats.realProfit += profit;
        
        // Remove from pending positions
        const posIdx = this.stats.pendingPositions.findIndex(p => p.orderId === order.orderId);
        if (posIdx !== -1) this.stats.pendingPositions.splice(posIdx, 1);
        
        this.activeSellTPOrders.splice(i, 1);
        this.log(`💰 [Poll] TP FILLED! Price: ${order.price}, Profit: ${profit.toFixed(6)} USDT`, 'success');
      }
    }
  }

  async createBuyOrders(bestBid) {
    const needed = this.config.maxBuyOrders - this.activeBuyOrders.length;
    if (needed <= 0) return;

    // Check TOTAL: active buy orders + active TP orders
    const totalPotentialOrders = this.activeBuyOrders.length + this.activeSellTPOrders.length;
    
    if (totalPotentialOrders >= this.config.maxSellTPOrders) {
      this.log(`🛑 MAX TP REACHED (Buy: ${this.activeBuyOrders.length} + TP: ${this.activeSellTPOrders.length} = ${totalPotentialOrders}/${this.config.maxSellTPOrders})`, 'warning');
      return;
    }

    if (this.config.waitAfterBuyFill > 0 && this.lastBuyFillTime > 0) {
      const timeSince = Date.now() - this.lastBuyFillTime;
      if (timeSince < this.config.waitAfterBuyFill) {
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

  // ============== TP Order Queue System ==============
  
  // Add TP order to queue
  addToTPQueue(buyPrice, qty) {
    this.pendingTPQueue.push({ buyPrice, qty, timestamp: Date.now() });
    this.log(`📋 Added to TP queue: buyPrice=${buyPrice}, qty=${qty}, Queue size: ${this.pendingTPQueue.length}`, 'info');
    
    // Start processing if not already running
    this.processTPQueue();
  }

  // Process TP queue one by one
  async processTPQueue() {
    // Prevent multiple simultaneous processing
    if (this.isProcessingTPQueue) return;
    if (this.pendingTPQueue.length === 0) return;
    
    this.isProcessingTPQueue = true;
    
    while (this.pendingTPQueue.length > 0 && this.isRunning) {
      const item = this.pendingTPQueue.shift();
      this.log(`📋 Processing TP queue: buyPrice=${item.buyPrice}, qty=${item.qty}, Remaining: ${this.pendingTPQueue.length}`, 'info');
      
      try {
        await this.createSellTPOrder(item.buyPrice, item.qty);
        // Small delay between orders to avoid rate limits
        await this.sleep(100);
      } catch (error) {
        this.log(`❌ Failed to create TP order: ${error.message}`, 'error');
        // Re-add to queue if failed (retry)
        this.pendingTPQueue.unshift(item);
        await this.sleep(500);
      }
    }
    
    this.isProcessingTPQueue = false;
  }

  async createSellTPOrder(buyPrice, qty) {
    if (this.activeSellTPOrders.length >= this.config.maxSellTPOrders) {
      this.log(`⚠️ Max TP orders reached, market selling oldest...`, 'warning');
      
      let highestIdx = 0;
      for (let i = 1; i < this.activeSellTPOrders.length; i++) {
        if (this.activeSellTPOrders[i].price > this.activeSellTPOrders[highestIdx].price) {
          highestIdx = i;
        }
      }
      
      const highest = this.activeSellTPOrders[highestIdx];
      await this.cancelOrder(highest.orderId);
      this.stats.totalSellOrdersCanceled++;
      
      const marketOrderId = await this.placeMarketOrder('Sell', highest.qty);
      if (marketOrderId) {
        const orderbook = await this.fetchOrderbook();
        const sellPrice = orderbook ? orderbook.bestBid : highest.buyPrice;
        const profitLoss = (sellPrice - highest.buyPrice) * highest.qty;
        this.stats.realProfit += profitLoss;
        this.stats.totalSellOrdersFilled++;
        this.log(`💰 Market sold @ ~${sellPrice}, P/L: ${profitLoss.toFixed(6)}`, profitLoss >= 0 ? 'success' : 'error');
      }
      
      this.activeSellTPOrders.splice(highestIdx, 1);
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

  // ============== Helper Functions ==============

  async sellAllAtMarket() {
    if (this.activeSellTPOrders.length === 0) return;

    const orderbook = await this.fetchOrderbook();
    const bestBid = orderbook ? orderbook.bestBid : 0;

    for (const order of this.activeSellTPOrders) {
      try {
        await this.cancelOrder(order.orderId);
        this.stats.totalSellOrdersCanceled++;
        
        const sellOrderId = await this.placeMarketOrder('Sell', order.qty);
        if (sellOrderId) {
          const profitLoss = (bestBid - order.buyPrice) * order.qty;
          this.stats.realProfit += profitLoss;
          this.stats.marketSellProfit += profitLoss;
          this.stats.totalSellOrdersFilled++;
          this.log(`💰 Market sold ${order.qty} @ ~${bestBid}, P/L: ${profitLoss.toFixed(6)}`, profitLoss >= 0 ? 'success' : 'error');
        }
      } catch (error) {
        this.log(`Error selling: ${error.message}`, 'error');
      }
    }
    this.activeSellTPOrders = [];
    this.stats.pendingPositions = [];
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
      if (result.success) {
        return result.data.orderId;
      }
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
