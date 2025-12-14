const WebSocket = require('ws');
const crypto = require('../utils/crypto');
const https = require('https');

class MexcWebSocket {
  constructor() {
    this.apiKey = null;
    this.apiSecret = null;
    this.apiHost = 'api.mexc.com';
    this.ws = null;
    this.listenKey = null;
    this.keepAliveInterval = null;
    this.pingInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.isConnected = false;
    
    // Callbacks
    this.onOrderUpdate = null;
    this.onDealUpdate = null;
    this.onError = null;
    this.onConnect = null;
    this.onDisconnect = null;
  }

  setCredentials(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  setApiHost(host) {
    this.apiHost = host;
  }

  // Step 1: Get Listen Key from REST API
  async getListenKey() {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now().toString();
      const recvWindow = '5000';
      const queryString = `recvWindow=${recvWindow}&timestamp=${timestamp}`;
      const signature = crypto.createSignature(queryString, this.apiSecret);

      const options = {
        hostname: this.apiHost,
        path: `/api/v3/userDataStream?${queryString}&signature=${signature}`,
        method: 'POST',
        headers: {
          'X-MEXC-APIKEY': this.apiKey,
          'Content-Type': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.listenKey) {
              resolve(response.listenKey);
            } else {
              reject(new Error(response.msg || 'Failed to get listenKey'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  // Step 2: Extend Listen Key (call every 30 minutes)
  async extendListenKey() {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now().toString();
      const recvWindow = '5000';
      const queryString = `listenKey=${this.listenKey}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
      const signature = crypto.createSignature(queryString, this.apiSecret);

      const options = {
        hostname: this.apiHost,
        path: `/api/v3/userDataStream?${queryString}&signature=${signature}`,
        method: 'PUT',
        headers: {
          'X-MEXC-APIKEY': this.apiKey
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[WS] Listen key extended');
          resolve(true);
        });
      });

      req.on('error', (err) => {
        console.error('[WS] Failed to extend listen key:', err.message);
        reject(err);
      });
      req.end();
    });
  }

  // Step 3: Connect to WebSocket
  async connect() {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('API credentials not set');
    }

    try {
      // Get listen key
      this.listenKey = await this.getListenKey();
      console.log('[WS] Got listen key');

      // Connect to WebSocket
      const wsUrl = `wss://wbs-api.mexc.com/ws?listenKey=${this.listenKey}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('[WS] Connected to MEXC');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Subscribe to channels
        this.subscribe();

        // Start keep-alive (extend listen key every 30 min)
        this.startKeepAlive();

        if (this.onConnect) {
          this.onConnect();
        }
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[WS] Disconnected: ${code}`);
        this.isConnected = false;
        this.stopKeepAlive();

        if (this.onDisconnect) {
          this.onDisconnect(code, reason);
        }

        // Auto reconnect
        this.attemptReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[WS] Error:', error.message);
        if (this.onError) {
          this.onError(error);
        }
      });

      this.ws.on('pong', () => {
        // Connection is alive
      });

    } catch (error) {
      console.error('[WS] Connection failed:', error.message);
      this.attemptReconnect();
    }
  }

  // Step 4: Subscribe to order and deal channels
  subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Subscribe to order updates
    this.ws.send(JSON.stringify({
      method: 'SUBSCRIPTION',
      params: ['spot@private.orders.v3.api.pb']
    }));

    // Subscribe to deal/trade updates
    this.ws.send(JSON.stringify({
      method: 'SUBSCRIPTION',
      params: ['spot@private.deals.v3.api.pb']
    }));

    console.log('[WS] Subscribed to order & deal channels');
  }

  // Handle incoming WebSocket messages
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());

      // Order update
      if (message.channel === 'spot@private.orders.v3.api.pb' && message.privateOrders) {
        const order = message.privateOrders;
        const orderData = {
          symbol: message.symbol,
          orderId: order.clientId,
          price: parseFloat(order.price || 0),
          quantity: parseFloat(order.quantity || 0),
          avgPrice: parseFloat(order.avgPrice || 0),
          status: order.status,           // 1=open, 2=filled, 3=partial, 4=canceled, 5=partial-canceled
          tradeType: order.tradeType,     // 1=buy, 2=sell
          orderType: order.orderType,     // 1=limit, 5=market
          cumulativeQty: parseFloat(order.cumulativeQuantity || 0),
          cumulativeAmount: parseFloat(order.cumulativeAmount || 0),
          remainingQty: parseFloat(order.remainQuantity || 0),
          createTime: order.createTime,
          timestamp: message.sendTime
        };

        if (this.onOrderUpdate) {
          this.onOrderUpdate(orderData);
        }
      }

      // Deal/Trade update
      if (message.channel === 'spot@private.deals.v3.api.pb' && message.privateDeals) {
        const deal = message.privateDeals;
        const dealData = {
          symbol: message.symbol,
          orderId: deal.orderId,
          tradeId: deal.tradeId,
          price: parseFloat(deal.price || 0),
          quantity: parseFloat(deal.quantity || 0),
          amount: parseFloat(deal.amount || 0),
          tradeType: deal.tradeType,      // 1=buy, 2=sell
          isMaker: deal.isMaker,
          fee: parseFloat(deal.feeAmount || 0),
          feeCurrency: deal.feeCurrency,
          timestamp: deal.time
        };

        if (this.onDealUpdate) {
          this.onDealUpdate(dealData);
        }
      }

    } catch (error) {
      // Non-JSON message (ping/pong or binary)
    }
  }

  startKeepAlive() {
    // Extend listen key every 30 minutes
    this.keepAliveInterval = setInterval(async () => {
      try {
        await this.extendListenKey();
      } catch (error) {
        console.error('[WS] Keep alive error:', error.message);
      }
    }, 30 * 60 * 1000);

    // Send ping every 30 seconds
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30 * 1000);
  }

  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, delay);
  }

  disconnect() {
    this.stopKeepAlive();
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    console.log('[WS] Disconnected');
  }
}

module.exports = new MexcWebSocket();  // Singleton
