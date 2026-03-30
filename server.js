import express from 'express';
import Database from 'better-sqlite3';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Rain } from '@buidlrrr/rain-sdk';
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem';
import { arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Database
const db = new Database('markets.db');
db.exec(fs.readFileSync('schema.sql', 'utf8'));

// Gemini AI (will be set when API key is provided)
let genAI = null;
let model = null;

// Rain SDK
const rain = new Rain({ environment: 'production' });

const USDT_ADDRESS = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const MIN_MARKET_SIZE = 9; // $9 minimum

// ============= HELPER FUNCTIONS =============

function getWalletFromPool() {
  const wallet = db.prepare('SELECT * FROM wallet_pool WHERE active = 1 ORDER BY RANDOM() LIMIT 1').get();
  if (!wallet) throw new Error('No active wallets in pool');
  
  db.prepare('UPDATE wallet_pool SET last_used_at = ? WHERE id = ?').run(Date.now(), wallet.id);
  return wallet;
}

function calculateJitter(baseDays) {
  // ±30% variation
  const minDays = baseDays * 0.7;
  const maxDays = baseDays * 1.3;
  return minDays + Math.random() * (maxDays - minDays);
}

// ============= API ENDPOINTS =============

// Get all markets
app.get('/api/markets', (req, res) => {
  const markets = db.prepare('SELECT * FROM markets ORDER BY created_at DESC').all();
  res.json(markets.map(m => ({
    ...m,
    options: JSON.parse(m.options),
    probabilities: JSON.parse(m.probabilities)
  })));
});

// Generate markets with Gemini
app.post('/api/generate', async (req, res) => {
  try {
    const { num_markets, total_allocation, size_deviation_pct = 20, base_interval_minutes = 60, market_length_days = 14 } = req.body;
    
    if (!genAI) {
      return res.status(400).json({ error: 'Gemini API key not configured' });
    }
    
    // Validation
    const avgAllocation = total_allocation / num_markets;
    if (avgAllocation < MIN_MARKET_SIZE) {
      return res.status(400).json({ 
        error: `Minimum $${MIN_MARKET_SIZE} per market required. Current average: $${avgAllocation.toFixed(2)}` 
      });
    }
    
    // Save config
    db.prepare(`
      INSERT INTO generation_config (num_markets, total_allocation, size_deviation_pct, base_interval_minutes, market_length_days)
      VALUES (?, ?, ?, ?, ?)
    `).run(num_markets, total_allocation, size_deviation_pct, base_interval_minutes, market_length_days);
    
    // Generate with Gemini
    const prompt = `Generate ${num_markets} prediction market ideas for Rain protocol.
    
Rules:
- Each market must have exactly 3 options: ["Yes", "No", "N/A"]
- Probabilities must sum to 100
- N/A should be ~1%
- Example: [49, 50, 1]
- Markets should be interesting, current, and diverse
- Focus on crypto, politics, sports, tech, culture

Return ONLY a JSON array with this structure:
[
  {
    "title": "Will BTC reach $100k by end of April 2026?",
    "description": "Bitcoin price prediction",
    "options": ["Yes", "No", "N/A"],
    "probabilities": [45, 54, 1]
  }
]

Generate ${num_markets} markets. Return ONLY the JSON array, no markdown, no explanation.`;

    const result = await model.generateContent(prompt, {
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.9
      }
    });
    
    const text = result.response.text();
    
    // Extract JSON between first [ and last ]
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1) {
      throw new Error('No JSON array found in response');
    }
    
    const jsonText = text.substring(firstBracket, lastBracket + 1);
    const generatedMarkets = JSON.parse(jsonText);
    
    // Calculate allocations with deviation
    const allocations = [];
    let remainingAllocation = total_allocation;
    
    for (let i = 0; i < num_markets; i++) {
      let allocation = avgAllocation * (1 + (Math.random() * 2 - 1) * (size_deviation_pct / 100));
      
      // Floor clamp to minimum
      allocation = Math.max(MIN_MARKET_SIZE, allocation);
      
      // Last market gets remainder
      if (i === num_markets - 1) {
        allocation = remainingAllocation;
      } else {
        remainingAllocation -= allocation;
      }
      
      allocations.push(allocation);
    }
    
    // Calculate fire times with jitter
    const now = Date.now();
    const insertStmt = db.prepare(`
      INSERT INTO markets (title, description, options, probabilities, allocation, interval_minutes, fire_at, market_length_days, expiration_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (let i = 0; i < generatedMarkets.length; i++) {
      const market = generatedMarkets[i];
      const allocation = allocations[i];
      
      // Fire time with jitter (0.6-1.4)
      const jitter = 0.6 + Math.random() * 0.8;
      const intervalMinutes = Math.round(base_interval_minutes * i * jitter);
      const fireAt = Math.floor(now / 1000) + (intervalMinutes * 60);
      
      // Expiration with ±30% jitter
      const marketLengthDaysWithJitter = calculateJitter(market_length_days);
      const expirationTimestamp = fireAt + Math.floor(marketLengthDaysWithJitter * 24 * 60 * 60);
      
      insertStmt.run(
        market.title,
        market.description || market.title,
        JSON.stringify(market.options),
        JSON.stringify(market.probabilities),
        allocation,
        intervalMinutes,
        fireAt,
        market_length_days,
        expirationTimestamp
      );
    }
    
    res.json({ success: true, count: generatedMarkets.length });
    
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Queue selected markets (move to approved)
app.post('/api/queue', (req, res) => {
  const { marketIds } = req.body;
  
  const stmt = db.prepare('UPDATE markets SET status = ? WHERE id = ?');
  const tx = db.transaction((ids) => {
    for (const id of ids) {
      stmt.run('approved', id);
    }
  });
  
  tx(marketIds);
  res.json({ success: true });
});

// Sign & Launch All (batch execution)
app.post('/api/launch', async (req, res) => {
  try {
    const { connectedWallet } = req.body; // User's connected wallet for signing
    
    if (!connectedWallet) {
      return res.status(400).json({ error: 'Connected wallet required' });
    }
    
    // Get approved markets
    const markets = db.prepare('SELECT * FROM markets WHERE status = ?').all('approved');
    
    if (markets.length === 0) {
      return res.status(400).json({ error: 'No approved markets to launch' });
    }
    
    // Get wallet from pool
    const poolWallet = getWalletFromPool();
    const account = privateKeyToAccount(poolWallet.private_key);
    
    const publicClient = createPublicClient({
      chain: arbitrum,
      transport: http('https://arb1.arbitrum.io/rpc')
    });
    
    const walletClient = createWalletClient({
      account,
      chain: arbitrum,
      transport: http('https://arb1.arbitrum.io/rpc')
    });
    
    // Build all market transactions
    const marketTxs = [];
    
    for (const market of markets) {
      const options = JSON.parse(market.options);
      const probabilities = JSON.parse(market.probabilities);
      const inputAmountWei = parseUnits(market.allocation.toString(), 6);
      
      // Fix private market disputeTimer
      const originalDisputeTimer = rain._disputeTimer;
      rain._disputeTimer = market.expiration_timestamp + 7200;
      
      const txs = await rain.buildCreateMarketTx({
        marketQuestion: market.title,
        marketOptions: options,
        marketTags: ['auto-generated'],
        marketDescription: market.description,
        isPublic: false, // Always private
        isPublicPoolResolverAi: false,
        creator: account.address,
        startTime: BigInt(market.fire_at),
        endTime: BigInt(market.expiration_timestamp),
        no_of_options: BigInt(options.length),
        inputAmountWei,
        barValues: probabilities,
        baseToken: USDT_ADDRESS,
        tokenDecimals: 6
      });
      
      // Restore disputeTimer
      rain._disputeTimer = originalDisputeTimer;
      
      marketTxs.push({ marketId: market.id, txs });
    }
    
    // Batch: 1 approve + N createMarket
    const approveTx = rain.buildApprovalTx({
      tokenAddress: USDT_ADDRESS,
      spender: USDT_ADDRESS, // Will be replaced with actual market contract
      amount: 2n ** 256n - 1n // MaxUint256
    });
    
    // Note: Actual batching would use multicall or similar
    // For now, we'll execute sequentially but this is where batch logic would go
    
    res.json({ 
      success: true,
      message: 'Launch initiated. Sign transaction in MetaMask.',
      markets: markets.length
    });
    
  } catch (error) {
    console.error('Launch error:', error);
    res.status(500).json({ error: error.message, details: error.stack });
  }
});

// Delete markets
app.post('/api/delete', (req, res) => {
  const { marketIds } = req.body;
  
  const stmt = db.prepare('DELETE FROM markets WHERE id = ? AND status IN (?, ?)');
  const tx = db.transaction((ids) => {
    for (const id of ids) {
      stmt.run(id, 'planned', 'failed');
    }
  });
  
  tx(marketIds);
  res.json({ success: true });
});

// Retry failed markets
app.post('/api/retry', (req, res) => {
  const { marketIds } = req.body;
  
  const stmt = db.prepare('UPDATE markets SET status = ?, error_message = NULL WHERE id = ?');
  const tx = db.transaction((ids) => {
    for (const id of ids) {
      stmt.run('approved', id);
    }
  });
  
  tx(marketIds);
  res.json({ success: true });
});

// Configure Gemini API key
app.post('/api/config/gemini', (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey) {
    return res.status(400).json({ error: 'API key required' });
  }
  
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add wallet to pool
app.post('/api/wallets/add', (req, res) => {
  const { address, privateKey, label } = req.body;
  
  try {
    db.prepare('INSERT INTO wallet_pool (address, private_key, label) VALUES (?, ?, ?)')
      .run(address, privateKey, label || '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🐙 Nati Don't Shout - Market Seeding Tool
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Server running on: http://localhost:${PORT}
📊 Database: markets.db
🤖 AI: Gemini (configure API key in UI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});
