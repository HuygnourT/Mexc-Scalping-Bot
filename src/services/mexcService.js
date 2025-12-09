const crypto = require('../utils/crypto');
const https = require('https');

const MEXC_API_HOST = 'api.mexc.com';

async function createOrder({ apiKey, apiSecret, symbol, side, orderType, qty, price }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  let params = {
    symbol: symbol,
    side: side.toUpperCase(),
    type: orderType.toUpperCase(),
    quantity: qty,
    timestamp: timestamp,
    recvWindow: recvWindow
  };

  if (orderType.toUpperCase() === 'LIMIT' && price) {
    params.price = price;
  }

  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys.map(key => `${key}=${params[key]}`).join('&');
  const signature = crypto.createSignature(queryString, apiSecret);
  const signedQueryString = `${queryString}&signature=${signature}`;

  const options = {
    hostname: MEXC_API_HOST,
    path: `/api/v3/order?${signedQueryString}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MEXC-APIKEY': apiKey
    }
  };

  return makeRequest(options);
}

async function getWalletBalance({ apiKey, apiSecret }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const queryString = `recvWindow=${recvWindow}&timestamp=${timestamp}`;
  const signature = crypto.createSignature(queryString, apiSecret);
  const signedQueryString = `${queryString}&signature=${signature}`;

  const options = {
    hostname: MEXC_API_HOST,
    path: `/api/v3/account?${signedQueryString}`,
    method: 'GET',
    headers: {
      'X-MEXC-APIKEY': apiKey
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.balances) {
            resolve({
              success: true,
              data: {
                list: [{
                  coin: response.balances.map(b => ({
                    coin: b.asset,
                    walletBalance: b.free,
                    availableToWithdraw: b.free,
                    locked: b.locked
                  }))
                }]
              }
            });
          } else if (response.code) {
            resolve({ success: false, message: response.msg || 'Unknown error', code: response.code });
          } else {
            resolve({ success: false, message: 'Unexpected response format' });
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', (error) => { reject(error); });
    req.end();
  });
}

async function getOrderbook({ symbol }) {
  const options = {
    hostname: MEXC_API_HOST,
    path: `/api/v3/depth?symbol=${symbol}&limit=5`,
    method: 'GET'
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.bids && response.asks) {
            resolve({
              success: true,
              data: {
                bestBid: response.bids[0] ? response.bids[0][0] : '0',
                bestAsk: response.asks[0] ? response.asks[0][0] : '0'
              }
            });
          } else if (response.code) {
            resolve({ success: false, message: response.msg || 'Failed to fetch orderbook', code: response.code });
          } else {
            resolve({ success: false, message: 'No orderbook data' });
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', (error) => { reject(error); });
    req.end();
  });
}

async function getOrderStatus({ apiKey, apiSecret, symbol, orderId }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const queryString = `orderId=${orderId}&recvWindow=${recvWindow}&symbol=${symbol}&timestamp=${timestamp}`;
  const signature = crypto.createSignature(queryString, apiSecret);
  const signedQueryString = `${queryString}&signature=${signature}`;

  const options = {
    hostname: MEXC_API_HOST,
    path: `/api/v3/order?${signedQueryString}`,
    method: 'GET',
    headers: {
      'X-MEXC-APIKEY': apiKey
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.orderId) {
            resolve({
              success: true,
              data: {
                list: [{
                  orderId: response.orderId,
                  orderStatus: response.status,
                  cumExecQty: response.executedQty || '0',
                  avgPrice: response.price
                }]
              }
            });
          } else if (response.code) {
            resolve({ success: false, message: response.msg || 'Failed to get order status', code: response.code });
          } else {
            resolve({ success: true, data: { list: [] } });
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', (error) => { reject(error); });
    req.end();
  });
}

async function cancelOrder({ apiKey, apiSecret, symbol, orderId }) {
  const timestamp = Date.now().toString();
  const recvWindow = '5000';

  const queryString = `orderId=${orderId}&recvWindow=${recvWindow}&symbol=${symbol}&timestamp=${timestamp}`;
  const signature = crypto.createSignature(queryString, apiSecret);
  const signedQueryString = `${queryString}&signature=${signature}`;

  const options = {
    hostname: MEXC_API_HOST,
    path: `/api/v3/order?${signedQueryString}`,
    method: 'DELETE',
    headers: {
      'X-MEXC-APIKEY': apiKey
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.orderId || response.status === 'CANCELED') {
            resolve({ success: true, data: response });
          } else if (response.code) {
            if (response.code === -2011 || response.msg?.includes('Unknown order')) {
              resolve({ success: true, data: { message: 'Order already completed or canceled' } });
            } else {
              resolve({ success: false, message: response.msg || 'Failed to cancel order', code: response.code });
            }
          } else {
            resolve({ success: true, data: response });
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', (error) => { reject(error); });
    req.end();
  });
}

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.orderId) {
            resolve({
              success: true,
              data: { orderId: response.orderId, symbol: response.symbol, status: response.status }
            });
          } else if (response.code && response.code !== 0) {
            resolve({ success: false, message: response.msg || 'Request failed', code: response.code });
          } else {
            resolve({ success: true, data: response });
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', (error) => { reject(error); });
    if (body) { req.write(JSON.stringify(body)); }
    req.end();
  });
}

module.exports = {
  createOrder,
  getWalletBalance,
  getOrderbook,
  getOrderStatus,
  cancelOrder
};
