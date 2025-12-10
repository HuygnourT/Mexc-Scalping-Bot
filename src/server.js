const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const mexcService = require('./services/mexcService');
const ScalpingBot = require('./services/scalpingBot');

const app = express();
const PORT = process.env.PORT || 3000;

// Global bot instance
const bot = new ScalpingBot();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get bot status
app.get('/api/bot/status', (req, res) => {
  res.json({ success: true, data: bot.getStatus() });
});

// Start bot
app.post('/api/bot/start', (req, res) => {
  const config = req.body;
  
  if (!config.apiKey || !config.apiSecret || !config.symbol) {
    return res.status(400).json({ success: false, message: 'Missing required config' });
  }
  
  bot.init(config);
  bot.start().then(result => res.json(result));
});

// Stop bot
app.post('/api/bot/stop', async (req, res) => {
  const result = await bot.stop();
  res.json(result);
});

// Pause bot
app.post('/api/bot/pause', async (req, res) => {
  const result = await bot.pause();
  res.json(result);
});

// Resume bot
app.post('/api/bot/resume', async (req, res) => {
  const result = await bot.resume();
  res.json(result);
});

// Test single order
app.post('/api/bot/test', async (req, res) => {
  const config = req.body;
  
  if (!config.apiKey || !config.apiSecret || !config.symbol) {
    return res.status(400).json({ success: false, message: 'Missing required config' });
  }
  
  bot.init(config);
  const result = await bot.testSingleOrder();
  res.json(result);
});

// Clear stats
app.post('/api/bot/clear-stats', (req, res) => {
  if (bot.isRunning) {
    return res.json({ success: false, message: 'Cannot clear stats while bot is running' });
  }
  bot.resetStats();
  res.json({ success: true, message: 'Stats cleared' });
});

// Update config while running
app.post('/api/bot/update-config', (req, res) => {
  if (!bot.isRunning) {
    return res.json({ success: false, message: 'Bot is not running' });
  }
  const config = req.body;
  const result = bot.updateConfig(config);
  res.json(result);
});

// Get run history
app.get('/api/bot/history', (req, res) => {
  res.json({ success: true, data: bot.getRunHistory() });
});

// Clear run history
app.post('/api/bot/clear-history', (req, res) => {
  const result = bot.clearHistory();
  res.json(result);
});

// Get wallet balance
app.post('/api/wallet/balance', async (req, res) => {
  try {
    const { apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ success: false, message: 'Missing API credentials' });
    }
    const result = await mexcService.getWalletBalance({ apiKey, apiSecret });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Set API host
app.post('/api/set-host', (req, res) => {
  const { host } = req.body;
  if (!host) {
    return res.status(400).json({ success: false, message: 'Missing host' });
  }
  mexcService.setApiHost(host);
  res.json({ success: true, message: `API host set to ${host}`, host });
});

// Get current API host
app.get('/api/get-host', (req, res) => {
  res.json({ success: true, host: mexcService.getApiHost() });
});

// Get orderbook
app.post('/api/orderbook', async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ success: false, message: 'Missing symbol' });
    }
    const result = await mexcService.getOrderbook({ symbol });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MEXC Scalping Bot running on http://localhost:${PORT}`);
});
