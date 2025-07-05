# Solana MEV Bot - Optimized Arbitrage Trading

A high-performance MEV (Maximal Extractable Value) bot for Solana that performs atomic arbitrage between token pairs. This bot is optimized to avoid transaction size limits and never falls back to separate swaps.

## 🚀 Features

- **Atomic Transactions Only**: All trades executed atomically
- **Optimized Transaction Size**: Stays within Solana's 1232-byte limit
- **Multiple Token Support**: Works with any token pair (tested with USDC/SOL)
- **Smart ALT Management**: Optimizes Address Lookup Tables
- **Simulation Before Execution**: Validates transactions before broadcasting


![image](https://github.com/user-attachments/assets/761cd940-a92d-4362-8480-b18a5ee08533)

*Example of one tx done with the bot
## 📋 Prerequisites

- Node.js 16+ 
- npm or yarn
- Solana wallet with SOL for transaction fees
- **WSOL (Wrapped SOL)** - Required for trading (obtain via `wrapper.js`)

## 🛠️ Installation

1. **Clone and install**
```bash
git clone <your-repo-url>
cd Pattern
npm install
```

2. **Get WSOL first** (Required!)
```bash
node wrapper.js
```
This will wrap 0.3 SOL into WSOL. You need WSOL to trade with the MEV bot.

3. **Configure your private key**
Edit `mev_optimized.js`:
```javascript
const PRIVATE_KEY_BASE58 = 'your-private-key-here';
```

## 🎯 Quick Start

### Basic Usage (USDC/SOL)
```bash
node mev_optimized.js
```

### Custom Token Pairs
Edit the configuration in `mev_optimized.js`:
```javascript
// Change these for different token pairs
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';  // USDC
const WSOL_MINT = 'So11111111111111111111111111111111111111112';   // Wrapped SOL

// Trading parameters
const INPUT_USDC = 10_000_000;   // 10 USDC (6 decimals)
const MIN_PROFIT_USDC = 1200;    // 0.0012 USDC minimum profit
const SLIPPAGE_BPS = 1;          // 1% slippage tolerance
```

## ⚠️ Important Notes

### WSOL Requirement
- **You MUST have WSOL (Wrapped SOL) to use this bot**
- Run `wrapper.js` first to convert SOL to WSOL
- The bot uses WSOL for trading, not native SOL

### Security
- Never share your private key
- Use a dedicated wallet for trading
- Start with small amounts for testing

### Performance
- Checks for opportunities every 5 seconds
- Automatically retries failed transactions
- Detailed logging for monitoring

## 📊 Supported Token Pairs

- **USDC/SOL**: Fully tested and optimized
- **Any SPL Token Pair**: Works with any token on Solana - Test it first with small amounts

## 🔍 Troubleshooting

**"Insufficient balance"**
- Make sure you have WSOL (run `wrapper.js` first)
- Check USDC balance for the input amount

**"Transaction too large"**
- Bot automatically optimizes transaction size
- Should resolve automatically

**"Simulation failed"**
- Check token balances
- Verify slippage settings
- Ensure sufficient SOL for fees

## ⚠️ Disclaimer

This software is for educational purposes. Trading cryptocurrencies involves significant risk. Use at your own risk.

---

**Note**: Tested with USDC/SOL pairs on Solana mainnet. Always test with small amounts first. 
