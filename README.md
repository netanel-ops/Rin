# Nati Don't Shout - Market Seeding Tool

🐙 AI-powered prediction market generator for Rain Protocol

## Features

- ✅ AI market generation with Gemini
- ✅ Batch transaction signing
- ✅ Private market support with disputeTimer fix
- ✅ Wallet pool system
- ✅ Live countdown timers
- ✅ Queue & retry system
- ✅ Mobile-responsive UI

## Installation

### Prerequisites
- Node.js 18+
- Gemini API key: https://aistudio.google.com/apikey

### Setup

```bash
# Install dependencies
npm install

# Start server
npm start

# Development mode (auto-reload)
npm run dev
```

Server runs on: http://localhost:3000

## Configuration

### 1. Gemini API Key
- Open the UI
- Enter your Gemini API key in the Configuration section
- Click "Save API Key"

### 2. Wallet Pool
Add wallets via API or directly to database:

```bash
curl -X POST http://localhost:3000/api/wallets/add \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0x...",
    "privateKey": "0x...",
    "label": "Wallet 1"
  }'
```

## Usage

1. **Configure** - Set Gemini API key
2. **Generate** - Create markets with AI
3. **Queue** - Select and queue markets
4. **Launch** - Sign & execute batch transaction

## Database

SQLite database (`markets.db`) with tables:
- `markets` - Generated markets
- `generation_config` - Generation history
- `wallet_pool` - Execution wallets
- `execution_log` - Transaction logs

## API Endpoints

- `GET /api/markets` - List all markets
- `POST /api/generate` - Generate markets with AI
- `POST /api/queue` - Queue selected markets
- `POST /api/launch` - Execute batch transaction
- `POST /api/delete` - Delete markets
- `POST /api/retry` - Retry failed markets
- `POST /api/config/gemini` - Set Gemini API key
- `POST /api/wallets/add` - Add wallet to pool

## Deployment

### Render.com

1. Push code to GitHub
2. Connect Render to GitHub
3. Create new Web Service
4. Select repository
5. Build command: `npm install`
6. Start command: `npm start`
7. Deploy!

### Vercel

```bash
vercel deploy
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- Set Gemini API key via UI (stored in memory)

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (better-sqlite3)
- **AI:** Google Gemini
- **Blockchain:** Rain SDK + Viem
- **Frontend:** Vanilla JS + CSS

## Credits

Built by Joni 🐙 for Nati

## License

MIT
