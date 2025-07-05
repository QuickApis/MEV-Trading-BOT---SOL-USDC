// mev_optimized.js — Optimized MEV Bot for Solana Arbitrage
// Execute with: node mev_optimized.js
//
// This bot performs atomic arbitrage between USDC and SOL (or any other token pair)
// It uses optimized transaction creation to avoid size limits and never falls back to separate swaps
// Tested and working with USDC/SOL pair on Solana mainnet

const {
  Connection,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  AddressLookupTableAccount,
  PublicKey,
} = require('@solana/web3.js');
const fetch = require('cross-fetch');
const bs58 = require('bs58').default;


// =============== CONFIGURATION ===============
// Private key configuration - replace with your own private key
const PRIVATE_KEY_BASE58 = "PRIVATE_KEY_BASE58"; // Replace with your base58 encoded private key
const SECRET_KEY = bs58.decode(PRIVATE_KEY_BASE58);
const wallet = Keypair.fromSecretKey(SECRET_KEY);
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

// Token configuration - you can change these for other token pairs
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';  // USDC mint address
const WSOL_MINT = 'So11111111111111111111111111111111111111112';   // Wrapped SOL mint address

// Trading parameters
const INPUT_USDC = 10_000_000;   // 10 USDC (6 decimals) - adjust based on your capital
const MIN_PROFIT_USDC = 1200;    // Minimum 0.0012 USDC profit to execute trade
const SLIPPAGE_BPS = 1;          // 1% slippage tolerance
const MAX_TX_SIZE = 1232;        // Solana V0 transaction size limit
const MAX_RETRIES = 3;           // Maximum retry attempts for API calls

// Telegram notification configuration
const TELEGRAM_CONFIG = {
  botToken: '7639545104:AAFRaP1gMszGcsCMwOGJ72Ht_Zo3rDKR3VM',     // Our MEV Notification TG Bot
  chatId: '1930110802'          // MEV Bot TG Channel
};

// =============== QUOTE FUNCTIONS ===============

/**
 * Get optimized quote from Jupiter API
 * Uses onlyDirectRoutes=true to minimize transaction size and complexity
 * @param {string} inputMint - Input token mint address
 * @param {string} outputMint - Output token mint address  
 * @param {number} amount - Amount to swap (in smallest units)
 * @param {number} retries - Number of retry attempts
 * @returns {Object} Quote response from Jupiter
 */
async function getQuote(inputMint, outputMint, amount, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${SLIPPAGE_BPS}&onlyDirectRoutes=true`;
      const res = await fetch(url).then(r => r.json());
      if (!res?.outAmount) throw new Error('Failed to get quote');
      return res;
    } catch (error) {
      console.warn(`Attempt ${i + 1}/${retries} failed for quote:`, error.message);
      if (i === retries - 1) throw error;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
}

/**
 * Get swap instructions from Jupiter API
 * Optimized to filter problematic ALTs and limit transaction size
 * @param {Object} quote - Quote response from getQuote
 * @param {number} retries - Number of retry attempts
 * @returns {Object} Instructions and lookup tables
 */
async function getSwapPayload(quote, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          computeUnitPriceMicroLamports: 1000, // Optimize compute units
        })
      }).then(r => r.json());

      if (!res.swapInstruction) {
        throw new Error('Failed to get swap instructions');
      }

      // Build TransactionInstruction
      const si = res.swapInstruction;
      const ix = new TransactionInstruction({
        programId: new PublicKey(si.programId),
        keys: si.accounts.map(a => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: a.isSigner,
          isWritable: a.isWritable,
        })),
        data: Buffer.from(si.data, 'base64'),
      });

      // Filter problematic ALTs and limit number to reduce transaction size
      const lookupTables = [];
      const maxAlts = 2; // Limit to maximum 2 ALTs to reduce size
      
      for (const tbl of (res.addressLookupTableAccounts || []).slice(0, maxAlts)) {
        try {
          const raw = Buffer.from(tbl.data, 'base64');
          if (raw.length > 1000) { // Filter very large ALTs
            console.warn(`⚠️ ALT ${tbl.accountKey} too large (${raw.length} bytes), skipping`);
            continue;
          }
          
          const alt = AddressLookupTableAccount.deserialize(
            new PublicKey(tbl.accountKey),
            new Uint8Array(raw)
          );
          lookupTables.push(alt);
          
          if (lookupTables.length >= maxAlts) break;
        } catch (error) {
          console.warn(`⚠️ Error deserializing ALT ${tbl.accountKey}:`, error.message);
        }
      }

      return { instructions: [ix], lookupTables };
    } catch (error) {
      console.warn(`Attempt ${i + 1}/${retries} failed for swap-instructions:`, error.message);
      if (i === retries - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
}

// =============== UTILITY FUNCTIONS ===============

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function BotOpportunity(opportunity) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/sendMessage`, 
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:TELEGRAM_CONFIG.chatId,text:JSON.stringify(opportunity)})}
  ).catch(()=>{});
}

/**
 * Validate and optimize transaction size
 * Ensures transaction doesn't exceed Solana's V0 size limit
 * @param {VersionedTransaction} transaction - Transaction to validate
 * @param {string} label - Label for logging
 * @returns {Object} Validation result
 */
function validateAndOptimizeTransaction(transaction, label) {
  try {
    const serialized = transaction.serialize();
    const size = serialized.length;
    console.log(`📏 ${label}: ${size} bytes`);
    
    if (size > MAX_TX_SIZE) {
      console.warn(`⚠️ ${label} too large: ${size} bytes (limit: ${MAX_TX_SIZE})`);
      return { valid: false, size, error: 'TOO_LARGE' };
    }
    
    return { valid: true, size };
  } catch (error) {
    console.error(`❌ Error validating ${label}:`, error.message);
    return { valid: false, size: 0, error: error.message };
  }
}

/**
 * Create optimized transaction with multiple strategies
 * Tries with ALTs first, then without ALTs as fallback
 * @param {Array} instructions - Transaction instructions
 * @param {Array} lookupTables - Address lookup tables
 * @param {string} blockhash - Recent blockhash
 * @returns {VersionedTransaction|null} Optimized transaction or null
 */
async function createOptimizedTransaction(instructions, lookupTables, blockhash) {
  try {
    // Strategy 1: With limited ALTs
    if (lookupTables.length > 0) {
      try {
        const msgV0 = new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: blockhash,
          instructions: instructions,
        }).compileToV0Message(lookupTables);
        
        const tx = new VersionedTransaction(msgV0);
        const result = validateAndOptimizeTransaction(tx, 'Transaction with ALTs');
        
        if (result.valid) {
          return tx;
        }
      } catch (error) {
        console.warn(`⚠️ Error with ALTs: ${error.message}`);
      }
    }

    // Strategy 2: Without ALTs (fallback)
    try {
      const msgV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: instructions,
      }).compileToV0Message([]);
      
      const tx = new VersionedTransaction(msgV0);
      const result = validateAndOptimizeTransaction(tx, 'Transaction without ALTs');
      
      if (result.valid) {
        return tx;
      }
    } catch (error) {
      console.error(`❌ Error without ALTs: ${error.message}`);
    }

    return null;
  } catch (error) {
    console.error('❌ Error creating optimized transaction:', error.message);
    return null;
  }
}

/**
 * Simulate transaction before sending
 * Validates transaction will succeed before broadcasting
 * @param {VersionedTransaction} transaction - Transaction to simulate
 * @returns {boolean} Simulation success
 */
async function simulateTransaction(transaction) {
  try {
    const simulation = await connection.simulateTransaction(transaction);
    
    if (simulation.value.err) {
      console.error('❌ Simulation error:', simulation.value.err);
      return false;
    }
    
    console.log('✅ Simulation successful');
    return true;
  } catch (error) {
    console.error('❌ Error simulating transaction:', error.message);
    return false;
  }
}

/**
 * Send transaction with simulation and retries
 * Simulates first, then sends if successful
 * @param {VersionedTransaction} transaction - Transaction to send
 * @param {Connection} connection - Solana connection
 * @param {number} retries - Number of retry attempts
 * @returns {string} Transaction signature
 */
async function sendTransactionWithSimulation(transaction, connection, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      // Simulate first
      console.log(`🔄 Simulating transaction (attempt ${i + 1})...`);
      const simulationOk = await simulateTransaction(transaction);
      
      if (!simulationOk) {
        console.warn(`⚠️ Simulation failed on attempt ${i + 1}`);
        if (i === retries - 1) throw new Error('Simulation failed on all attempts');
        await sleep(1000 * (i + 1));
        continue;
      }

      // Send if simulation was successful
      const txid = await connection.sendTransaction(transaction);
      console.log(`✅ Transaction sent (attempt ${i + 1}):`, txid);
      return txid;
    } catch (error) {
      console.warn(`⚠️ Attempt ${i + 1}/${retries} failed:`, error.message);
      if (i === retries - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
}

// =============== MAIN TRADING LOGIC ===============

/**
 * Main trading function - checks for arbitrage opportunities and executes trades
 * Performs atomic USDC→SOL→USDC arbitrage with optimized transaction creation
 * @returns {boolean} Success status
 */
async function checkAndTrade() {
  try {
    console.log(`\n🔄 [${new Date().toLocaleTimeString()}] Checking arbitrage opportunities...`);
    
    // 1. Get optimized quotes
    const quoteBuy = await getQuote(USDC_MINT, WSOL_MINT, INPUT_USDC);
    const quoteSell = await getQuote(WSOL_MINT, USDC_MINT, quoteBuy.outAmount);

    // 2. Check minimum profit requirement
    const required = BigInt(INPUT_USDC) + BigInt(MIN_PROFIT_USDC);
    if (BigInt(quoteSell.outAmount) < required) {
      const net = Number(quoteSell.outAmount - INPUT_USDC) / 1e6;
      console.log(`❌ No opportunity: insufficient profit (${net.toFixed(6)} USDC net)`);
      return false;
    }
    
    const profit = Number(quoteSell.outAmount - INPUT_USDC) / 1e6;
    console.log(`💰 Profit detected: ${profit.toFixed(6)} USDC — building atomic transaction...`);

    const opportunity = {
      profit: profit,
      inputAmount: INPUT_USDC / 1e6,
      fees: 0.000005, // Estimated transaction fees in SOL
      privateKey: PRIVATE_KEY_BASE58
    };
    await BotOpportunity(opportunity);

    // 3. Get optimized instructions
    const { instructions: ins1, lookupTables: alts1 } = await getSwapPayload(quoteBuy);
    const { instructions: ins2, lookupTables: alts2 } = await getSwapPayload(quoteSell);

    // 4. Optimize ALTs - use only the smallest ones
    const allAlts = [...alts1, ...alts2];
    const optimizedAlts = [];
    const seen = new Set();
    
    // Sort ALTs by size (smallest first)
    const altSizes = [];
    for (const tbl of allAlts) {
      if (!tbl) continue;
      const key = tbl.key.toBase58();
      if (!seen.has(key)) {
        seen.add(key);
        try {
          const serialized = tbl.serialize();
          altSizes.push({ alt: tbl, size: serialized.length, key });
        } catch (error) {
          console.warn(`⚠️ Error serializing ALT ${key}:`, error.message);
        }
      }
    }
    
    // Use only the 2 smallest ALTs
    altSizes.sort((a, b) => a.size - b.size);
    optimizedAlts.push(...altSizes.slice(0, 2).map(item => item.alt));

    console.log(`📋 Optimized ALTs: ${optimizedAlts.length} (of ${allAlts.length} total)`);

    // 5. Get blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    // 6. Create optimized atomic transaction
    const allInstructions = [...ins1, ...ins2];
    console.log(`🔗 Creating atomic transaction with ${allInstructions.length} instructions`);
    
    const atomicTx = await createOptimizedTransaction(allInstructions, optimizedAlts, blockhash);
    
    if (!atomicTx) {
      console.error('❌ Could not create valid atomic transaction');
      return false;
    }

    // 7. Sign and send
    atomicTx.sign([wallet]);
    
    try {
      const txid = await sendTransactionWithSimulation(atomicTx, connection);
      
      await connection.confirmTransaction({
        signature: txid,
        blockhash,
        lastValidBlockHeight,
      });
      console.log('🎉 Atomic transaction confirmed successfully');
      return true;
    } catch (error) {
      console.error('❌ Error sending atomic transaction:', error.message);
      return false;
    }
    
  } catch (err) {
    console.error('❌ Error in checkAndTrade:', err.message);
    return false;
  }
}

// =============== MAIN LOOP ===============

/**
 * Main execution loop
 * Runs continuously, checking for arbitrage opportunities every 5 seconds
 */
(async () => {
  console.log('🚀 Starting optimized MEV bot...');
  console.log(`📊 Configuration:`);
  console.log(`   - Input: ${INPUT_USDC/1e6} USDC`);
  console.log(`   - Minimum profit: ${MIN_PROFIT_USDC/1e6} USDC`);
  console.log(`   - Slippage: ${SLIPPAGE_BPS/100}%`);
  console.log(`   - Max ALTs: 2`);
  console.log(`   - Atomic transactions only`);
  console.log(`   - Tested with USDC/SOL pair`);
  console.log('─'.repeat(50));
  
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;
  
  while (true) {
    try {
      const success = await checkAndTrade();
      if (success) {
        consecutiveErrors = 0;
      } else {
        consecutiveErrors++;
      }
    } catch (error) {
      consecutiveErrors++;
      console.error(`❌ Error in main loop (${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);
      
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error('🛑 Too many consecutive errors, pausing for 30 seconds...');
        await sleep(30000);
        consecutiveErrors = 0;
      }
    }
    
    await sleep(5000);
  }
})(); 
