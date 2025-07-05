const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  createSyncNativeInstruction,
  NATIVE_MINT,
} = require('@solana/spl-token');
const bs58 = require('bs58').default;

// Configuration - Set your private key as environment variable or use default for testing
const PRIVATE_KEY_BASE58 = "PRIVATE_KEY_BASE58";
const SECRET_KEY = bs58.decode(PRIVATE_KEY_BASE58);
const wallet = Keypair.fromSecretKey(SECRET_KEY);
const connection = new Connection('https://api.mainnet-beta.solana.com');

/**
 * Wraps SOL into WSOL (Wrapped SOL) for use in DeFi protocols
 * @param {number} amountSol - Amount of SOL to wrap
 */
async function wrapSol(amountSol) {
  const amountLamports = amountSol * 1e9; // Convert SOL to lamports (1 SOL = 1e9 lamports)

  // 1. Get or create the associated token account for WSOL
  const wsolAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet, // payer
    NATIVE_MINT, // WSOL mint address
    wallet.publicKey
  );

  // 2. Transfer SOL to WSOL account and sync the native balance
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: wsolAccount.address,
      lamports: amountLamports,
    }),
    createSyncNativeInstruction(wsolAccount.address)
  );

  // 3. Send and confirm the transaction
  const txid = await sendAndConfirmTransaction(connection, transaction, [wallet]);
  console.log('WSOL wrapped successfully. Transaction ID:', txid);
  console.log('WSOL Account:', wsolAccount.address.toBase58());
}

// Execute the wrap function with 0.3 SOL
wrapSol(0.3).catch(console.error);
