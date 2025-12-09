# MEXC Scalping Bot 🤖

A maker-based scalping trading bot for MEXC Spot trading with server-side logic.

## Features

- **Server-side Trading Logic**: All trading logic runs on the server (Node.js)
- **Multi-Layer Buy Orders**: Place multiple buy orders at different price levels
- **Automatic Take-Profit**: Create TP orders when buys are filled
- **Price Repricing**: Automatically reprice orders when market moves
- **Pause/Resume**: Pause buying while keeping TP orders active
- **Sell All on Stop**: Option to market sell all positions when stopping

## Installation

```bash
npm install
npm start
```

Open `http://localhost:3000`

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| Tick Size | Minimum price increment | 0.0001 |
| Max Buy Orders | Maximum concurrent buys | 3 |
| Offset Ticks | Ticks below best bid | 0 |
| Layer Step Ticks | Ticks between layers | 2 |
| Buy TTL | Seconds before reprice | 30 |
| Reprice Ticks | Ticks to trigger reprice | 3 |
| Take Profit Ticks | Ticks above buy for TP | 10 |
| Max Sell TP Orders | Maximum TP orders | 20 |
| Order Quantity | Amount per order | 10 |
| Loop Interval | Loop cycle (ms) | 500 |

## API Endpoints

- `GET /api/bot/status` - Get bot status
- `POST /api/bot/start` - Start bot with config
- `POST /api/bot/stop` - Stop bot
- `POST /api/bot/pause` - Pause (keep TPs)
- `POST /api/bot/resume` - Resume buying
- `POST /api/bot/test` - Test single order
- `POST /api/wallet/balance` - Check balance

## Risk Warning ⚠️

Trading cryptocurrencies involves significant risk. Only trade with funds you can afford to lose.

## License

MIT
