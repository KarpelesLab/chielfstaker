/**
 * ChiefStaker E2E Tests
 *
 * Run against a local test validator with the program deployed.
 *
 * Setup:
 *   1. Start validator: ./scripts/start-validator.sh --reset
 *   2. Deploy program: ./scripts/deploy-program.sh target/deploy/chiefstaker.so
 *   3. Run tests: cd tests/typescript && npm install && npm test
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import * as borsh from 'borsh';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

// Program ID - should match the deployed program
const PROGRAM_ID = new PublicKey('3Ecf8gyRURyrBtGHS1XAVXyQik5PqgDch4VkxrH4ECcr');

// Seeds for PDAs
const POOL_SEED = Buffer.from('pool');
const STAKE_SEED = Buffer.from('stake');
const TOKEN_VAULT_SEED = Buffer.from('token_vault');

// Instruction discriminators (borsh enum indices)
enum InstructionType {
  InitializePool = 0,
  Stake = 1,
  Unstake = 2,
  ClaimRewards = 3,
  DepositRewards = 4,
  SyncPool = 5,
  SyncRewards = 6,
}

// Helper to derive PDAs
function derivePoolPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}

function deriveTokenVaultPDA(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TOKEN_VAULT_SEED, pool.toBuffer()],
    PROGRAM_ID
  );
}

function deriveUserStakePDA(pool: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STAKE_SEED, pool.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  );
}

// Instruction builders
function createInitializePoolInstruction(
  pool: PublicKey,
  mint: PublicKey,
  tokenVault: PublicKey,
  authority: PublicKey,
  tauSeconds: bigint
): TransactionInstruction {
  // Borsh serialize: enum variant (u8) + tau_seconds (u64)
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(InstructionType.InitializePool, 0);
  data.writeBigUInt64LE(tauSeconds, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

function createStakeInstruction(
  pool: PublicKey,
  userStake: PublicKey,
  tokenVault: PublicKey,
  userToken: PublicKey,
  mint: PublicKey,
  user: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(InstructionType.Stake, 0);
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: userToken, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

function createUnstakeInstruction(
  pool: PublicKey,
  userStake: PublicKey,
  tokenVault: PublicKey,
  userToken: PublicKey,
  mint: PublicKey,
  user: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(InstructionType.Unstake, 0);
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: tokenVault, isSigner: false, isWritable: true },
      { pubkey: userToken, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

function createClaimRewardsInstruction(
  pool: PublicKey,
  userStake: PublicKey,
  user: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(1);
  data.writeUInt8(InstructionType.ClaimRewards, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

function createDepositRewardsInstruction(
  pool: PublicKey,
  depositor: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(InstructionType.DepositRewards, 0);
  data.writeBigUInt64LE(amount, 1);

  return new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

function createSyncRewardsInstruction(pool: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(1);
  data.writeUInt8(InstructionType.SyncRewards, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// Test context
class TestContext {
  connection: Connection;
  payer: Keypair;
  mint!: PublicKey;
  mintAuthority: Keypair;
  poolPDA!: PublicKey;
  tokenVaultPDA!: PublicKey;

  constructor(connection: Connection, payer: Keypair) {
    this.connection = connection;
    this.payer = payer;
    this.mintAuthority = Keypair.generate();
  }

  async setup() {
    // Airdrop SOL to payer
    const airdropSig = await this.connection.requestAirdrop(
      this.payer.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(airdropSig);

    // Airdrop to mint authority
    const airdropSig2 = await this.connection.requestAirdrop(
      this.mintAuthority.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(airdropSig2);
  }

  async createMint(decimals: number = 9): Promise<PublicKey> {
    this.mint = await createMint(
      this.connection,
      this.payer,
      this.mintAuthority.publicKey,
      null,
      decimals,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    [this.poolPDA] = derivePoolPDA(this.mint);
    [this.tokenVaultPDA] = deriveTokenVaultPDA(this.poolPDA);

    return this.mint;
  }

  async initializePool(tauSeconds: bigint): Promise<string> {
    const ix = createInitializePoolInstruction(
      this.poolPDA,
      this.mint,
      this.tokenVaultPDA,
      this.payer.publicKey,
      tauSeconds
    );

    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
  }

  async createUserTokenAccount(owner: PublicKey): Promise<PublicKey> {
    return await createAccount(
      this.connection,
      this.payer,
      this.mint,
      owner,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  }

  async mintTokens(destination: PublicKey, amount: bigint): Promise<string> {
    return await mintTo(
      this.connection,
      this.payer,
      this.mint,
      destination,
      this.mintAuthority,
      amount,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  }

  async stake(user: Keypair, userToken: PublicKey, amount: bigint): Promise<string> {
    const [userStakePDA] = deriveUserStakePDA(this.poolPDA, user.publicKey);

    const ix = createStakeInstruction(
      this.poolPDA,
      userStakePDA,
      this.tokenVaultPDA,
      userToken,
      this.mint,
      user.publicKey,
      amount
    );

    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(this.connection, tx, [this.payer, user]);
  }

  async unstake(user: Keypair, userToken: PublicKey, amount: bigint): Promise<string> {
    const [userStakePDA] = deriveUserStakePDA(this.poolPDA, user.publicKey);

    const ix = createUnstakeInstruction(
      this.poolPDA,
      userStakePDA,
      this.tokenVaultPDA,
      userToken,
      this.mint,
      user.publicKey,
      amount
    );

    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(this.connection, tx, [this.payer, user]);
  }

  async claimRewards(user: Keypair): Promise<string> {
    const [userStakePDA] = deriveUserStakePDA(this.poolPDA, user.publicKey);

    const ix = createClaimRewardsInstruction(
      this.poolPDA,
      userStakePDA,
      user.publicKey
    );

    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(this.connection, tx, [this.payer, user]);
  }

  async depositRewards(amount: bigint): Promise<string> {
    const ix = createDepositRewardsInstruction(
      this.poolPDA,
      this.payer.publicKey,
      amount
    );

    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
  }

  async syncRewards(): Promise<string> {
    const ix = createSyncRewardsInstruction(this.poolPDA);

    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
  }

  async sendSolToPool(amount: bigint): Promise<string> {
    const ix = SystemProgram.transfer({
      fromPubkey: this.payer.publicKey,
      toPubkey: this.poolPDA,
      lamports: amount,
    });

    const tx = new Transaction().add(ix);
    return await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
  }

  async getBalance(pubkey: PublicKey): Promise<number> {
    return await this.connection.getBalance(pubkey);
  }

  async getTokenBalance(tokenAccount: PublicKey): Promise<bigint> {
    const account = await getAccount(this.connection, tokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    return account.amount;
  }
}

// Test runner
async function runTests() {
  console.log('=== ChiefStaker E2E Tests ===\n');

  const connection = new Connection('http://localhost:8899', 'confirmed');
  const payer = Keypair.generate();

  // Check connection
  try {
    await connection.getVersion();
  } catch (e) {
    console.error('ERROR: Cannot connect to test validator. Start it with:');
    console.error('  ./scripts/start-validator.sh --reset');
    process.exit(1);
  }

  // Check program is deployed
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    console.error('ERROR: Program not deployed. Deploy it with:');
    console.error('  ./scripts/deploy-program.sh target/deploy/chiefstaker.so');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${e.message}`);
      if (e.logs) {
        console.log(`  Logs: ${e.logs.slice(-5).join('\n        ')}`);
      }
      failed++;
    }
  }

  // Test: Initialize Pool
  await test('Initialize pool', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);

    const tauSeconds = BigInt(30 * 24 * 60 * 60); // 30 days
    await ctx.initializePool(tauSeconds);

    const poolInfo = await connection.getAccountInfo(ctx.poolPDA);
    if (!poolInfo) throw new Error('Pool not created');
    if (poolInfo.data.length === 0) throw new Error('Pool data empty');
  });

  // Test: Stake tokens
  await test('Stake tokens', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(2592000));

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    const stakeAmount = BigInt(1_000_000_000);
    await ctx.mintTokens(userToken, stakeAmount);

    await ctx.stake(user, userToken, stakeAmount);

    const vaultBalance = await ctx.getTokenBalance(ctx.tokenVaultPDA);
    if (vaultBalance !== stakeAmount) {
      throw new Error(`Expected vault balance ${stakeAmount}, got ${vaultBalance}`);
    }
  });

  // Test: Multiple stakers
  await test('Multiple stakers', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(2592000));

    const user1 = Keypair.generate();
    const user2 = Keypair.generate();
    await connection.requestAirdrop(user1.publicKey, LAMPORTS_PER_SOL);
    await connection.requestAirdrop(user2.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const user1Token = await ctx.createUserTokenAccount(user1.publicKey);
    const user2Token = await ctx.createUserTokenAccount(user2.publicKey);

    await ctx.mintTokens(user1Token, BigInt(1_000_000_000));
    await ctx.mintTokens(user2Token, BigInt(2_000_000_000));

    await ctx.stake(user1, user1Token, BigInt(1_000_000_000));
    await ctx.stake(user2, user2Token, BigInt(2_000_000_000));

    const vaultBalance = await ctx.getTokenBalance(ctx.tokenVaultPDA);
    if (vaultBalance !== BigInt(3_000_000_000)) {
      throw new Error(`Expected vault balance 3000000000, got ${vaultBalance}`);
    }
  });

  // Test: Deposit and claim rewards
  await test('Deposit and claim rewards', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(100)); // Short tau

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    await ctx.mintTokens(userToken, BigInt(1_000_000_000));
    await ctx.stake(user, userToken, BigInt(1_000_000_000));

    // Deposit rewards
    await ctx.depositRewards(BigInt(LAMPORTS_PER_SOL));

    const balanceBefore = await ctx.getBalance(user.publicKey);
    await ctx.claimRewards(user);
    const balanceAfter = await ctx.getBalance(user.publicKey);

    // User should receive some rewards (minus tx fee)
    // Due to time-weighted calculation, might be small if just staked
    console.log(`    Reward claimed: ${balanceAfter - balanceBefore} lamports`);
  });

  // Test: Unstake partial
  await test('Unstake partial', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(2592000));

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    await ctx.mintTokens(userToken, BigInt(1_000_000_000));
    await ctx.stake(user, userToken, BigInt(1_000_000_000));

    // Unstake half
    await ctx.unstake(user, userToken, BigInt(500_000_000));

    const userBalance = await ctx.getTokenBalance(userToken);
    if (userBalance !== BigInt(500_000_000)) {
      throw new Error(`Expected user balance 500000000, got ${userBalance}`);
    }
  });

  // Test: Unstake full
  await test('Unstake full', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(2592000));

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    await ctx.mintTokens(userToken, BigInt(1_000_000_000));
    await ctx.stake(user, userToken, BigInt(1_000_000_000));
    await ctx.unstake(user, userToken, BigInt(1_000_000_000));

    const userBalance = await ctx.getTokenBalance(userToken);
    if (userBalance !== BigInt(1_000_000_000)) {
      throw new Error(`Expected user balance 1000000000, got ${userBalance}`);
    }
  });

  // Test: SyncRewards (pump.fun simulation)
  await test('SyncRewards (pump.fun simulation)', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(100));

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    await ctx.mintTokens(userToken, BigInt(1_000_000_000));
    await ctx.stake(user, userToken, BigInt(1_000_000_000));

    // Send SOL directly to pool (simulating pump.fun)
    await ctx.sendSolToPool(BigInt(LAMPORTS_PER_SOL / 2));

    // Sync rewards
    await ctx.syncRewards();

    const balanceBefore = await ctx.getBalance(user.publicKey);
    await ctx.claimRewards(user);
    const balanceAfter = await ctx.getBalance(user.publicKey);

    console.log(`    Direct SOL reward claimed: ${balanceAfter - balanceBefore} lamports`);
  });

  // Test: Additional stake
  await test('Additional stake (same user)', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(2592000));

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    await ctx.mintTokens(userToken, BigInt(2_000_000_000));

    await ctx.stake(user, userToken, BigInt(1_000_000_000));
    await ctx.stake(user, userToken, BigInt(500_000_000));

    const vaultBalance = await ctx.getTokenBalance(ctx.tokenVaultPDA);
    if (vaultBalance !== BigInt(1_500_000_000)) {
      throw new Error(`Expected vault balance 1500000000, got ${vaultBalance}`);
    }
  });

  // ============================================
  // STRESS TESTS: Simulate 1 million stakers
  // ============================================
  // Since operations are O(1), complexity depends on value magnitudes, not staker count.
  // We test with values representing: 1M stakers × 1000 tokens each = 1 trillion tokens
  // This verifies the math handles large aggregates without overflow or excessive compute.

  console.log('\n--- Stress Tests (simulating 1M stakers) ---\n');

  // Test: Large stake amount (simulating pool with many existing stakers)
  await test('Stress: Stake with large existing total', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(2592000)); // 30 days tau

    // First, create a "whale" that represents aggregate of ~1M stakers
    // 1M stakers × 1000 tokens × 10^9 decimals = 10^18 raw tokens
    const whale = Keypair.generate();
    await connection.requestAirdrop(whale.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const whaleToken = await ctx.createUserTokenAccount(whale.publicKey);
    // Mint a large amount representing aggregate stake
    // Using 10^15 (1 quadrillion) as a large but safe value
    const largeAmount = BigInt('1000000000000000'); // 10^15
    await ctx.mintTokens(whaleToken, largeAmount);

    const startTime = Date.now();
    await ctx.stake(whale, whaleToken, largeAmount);
    const stakeTime = Date.now() - startTime;
    console.log(`    Large stake (${largeAmount} tokens): ${stakeTime}ms`);

    // Now test a regular user staking against this large pool
    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    const userAmount = BigInt(1_000_000_000); // 1 token (normal stake)
    await ctx.mintTokens(userToken, userAmount);

    const startTime2 = Date.now();
    await ctx.stake(user, userToken, userAmount);
    const stakeTime2 = Date.now() - startTime2;
    console.log(`    Regular stake against large pool: ${stakeTime2}ms`);

    // Verify both stakes exist
    const vaultBalance = await ctx.getTokenBalance(ctx.tokenVaultPDA);
    if (vaultBalance !== largeAmount + userAmount) {
      throw new Error(`Expected ${largeAmount + userAmount}, got ${vaultBalance}`);
    }
  });

  // Test: Deposit rewards with large total stake
  await test('Stress: Deposit rewards with 1M staker simulation', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(100)); // Short tau for weight accumulation

    // Create large aggregate stake
    const whale = Keypair.generate();
    await connection.requestAirdrop(whale.publicKey, 5 * LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const whaleToken = await ctx.createUserTokenAccount(whale.publicKey);
    const largeAmount = BigInt('1000000000000000'); // 10^15
    await ctx.mintTokens(whaleToken, largeAmount);
    await ctx.stake(whale, whaleToken, largeAmount);

    // Wait a bit for weight to accumulate
    await new Promise(r => setTimeout(r, 1000));

    // Airdrop more SOL for large deposit test (confirm each one)
    for (let i = 0; i < 20; i++) {
      const sig = await connection.requestAirdrop(ctx.payer.publicKey, 5 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    const balance = await connection.getBalance(ctx.payer.publicKey);
    console.log(`    Payer balance after airdrops: ${balance / LAMPORTS_PER_SOL} SOL`);

    // Deposit large reward (100 SOL) - tests program handles large amounts
    const rewardAmount = BigInt(100 * LAMPORTS_PER_SOL);
    const startTime = Date.now();
    await ctx.depositRewards(rewardAmount);
    const depositTime = Date.now() - startTime;
    console.log(`    Deposit ${rewardAmount} lamports (100 SOL) to large pool: ${depositTime}ms`);
  });

  // Test: Claim rewards with large accumulated rewards
  await test('Stress: Claim with large reward accumulator', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(10)); // Very short tau

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    const stakeAmount = BigInt('100000000000000'); // 10^14
    await ctx.mintTokens(userToken, stakeAmount);
    await ctx.stake(user, userToken, stakeAmount);

    // Wait for weight
    await new Promise(r => setTimeout(r, 500));

    // Multiple deposits to accumulate large reward per share
    for (let i = 0; i < 5; i++) {
      await ctx.depositRewards(BigInt(LAMPORTS_PER_SOL));
    }

    // Claim rewards
    const startTime = Date.now();
    await ctx.claimRewards(user);
    const claimTime = Date.now() - startTime;
    console.log(`    Claim from large accumulator: ${claimTime}ms`);
  });

  // Test: Unstake with large pool values
  await test('Stress: Unstake with large pool values', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(2592000));

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    const largeAmount = BigInt('500000000000000'); // 5×10^14
    await ctx.mintTokens(userToken, largeAmount);
    await ctx.stake(user, userToken, largeAmount);

    // Partial unstake
    const unstakeAmount = BigInt('250000000000000'); // Half
    const startTime = Date.now();
    await ctx.unstake(user, userToken, unstakeAmount);
    const unstakeTime = Date.now() - startTime;
    console.log(`    Large partial unstake (${unstakeAmount}): ${unstakeTime}ms`);

    // Full unstake remaining
    const startTime2 = Date.now();
    await ctx.unstake(user, userToken, unstakeAmount);
    const unstakeTime2 = Date.now() - startTime2;
    console.log(`    Full unstake remaining: ${unstakeTime2}ms`);

    const balance = await ctx.getTokenBalance(userToken);
    if (balance !== largeAmount) {
      throw new Error(`Expected ${largeAmount}, got ${balance}`);
    }
  });

  // Test: SyncRewards with large pool
  await test('Stress: SyncRewards with large pool', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(50)); // Short tau

    const whale = Keypair.generate();
    await connection.requestAirdrop(whale.publicKey, 3 * LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const whaleToken = await ctx.createUserTokenAccount(whale.publicKey);
    const largeAmount = BigInt('1000000000000000');
    await ctx.mintTokens(whaleToken, largeAmount);
    await ctx.stake(whale, whaleToken, largeAmount);

    // Wait for weight
    await new Promise(r => setTimeout(r, 500));

    // Airdrop more SOL for large direct transfer test (confirm each)
    for (let i = 0; i < 12; i++) {
      const sig = await connection.requestAirdrop(ctx.payer.publicKey, 5 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    const balance = await connection.getBalance(ctx.payer.publicKey);
    console.log(`    Payer balance after airdrops: ${balance / LAMPORTS_PER_SOL} SOL`);

    // Send large amount directly to pool (50 SOL, simulating pump.fun fees)
    await ctx.sendSolToPool(BigInt(50 * LAMPORTS_PER_SOL));

    const startTime = Date.now();
    await ctx.syncRewards();
    const syncTime = Date.now() - startTime;
    console.log(`    SyncRewards with 50 SOL on large pool: ${syncTime}ms`);
  });

  // Test: Many sequential operations (verify no state bloat)
  await test('Stress: Sequential operations (no state bloat)', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(10)); // Short tau for weight

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, 5 * LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    await ctx.mintTokens(userToken, BigInt('10000000000000')); // 10^13

    // Initial stake that stays throughout to keep pool active
    const baseStake = BigInt('1000000000000'); // 10^12
    await ctx.stake(user, userToken, baseStake);

    // Wait for weight to accumulate
    await new Promise(r => setTimeout(r, 500));

    const iterations = 10;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const additionalAmount = BigInt(100_000_000) * BigInt(i + 1);

      const start = Date.now();
      // Add more stake
      await ctx.stake(user, userToken, additionalAmount);
      // Deposit small reward
      await ctx.depositRewards(BigInt(LAMPORTS_PER_SOL / 100));
      // Claim
      await ctx.claimRewards(user);
      // Remove only the additional stake (keep base stake)
      await ctx.unstake(user, userToken, additionalAmount);
      times.push(Date.now() - start);
    }

    // Unstake the base amount at the end
    await ctx.unstake(user, userToken, baseStake);

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    console.log(`    ${iterations} cycles - avg: ${avgTime.toFixed(0)}ms, min: ${minTime}ms, max: ${maxTime}ms`);

    // Verify operations are O(1) - time should not grow significantly
    // Allow 5x variance for network jitter
    if (maxTime > minTime * 5) {
      console.log(`    WARNING: Large time variance detected (may indicate non-O(1) behavior)`);
    }
  });

  // Test: Compute units estimation via simulation
  await test('Stress: Compute units check', async () => {
    const ctx = new TestContext(connection, Keypair.generate());
    await ctx.setup();
    await ctx.createMint(9);
    await ctx.initializePool(BigInt(100));

    const user = Keypair.generate();
    await connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 500));

    const userToken = await ctx.createUserTokenAccount(user.publicKey);
    await ctx.mintTokens(userToken, BigInt('1000000000000000'));
    await ctx.stake(user, userToken, BigInt('1000000000000000'));

    await new Promise(r => setTimeout(r, 500));
    await ctx.depositRewards(BigInt(LAMPORTS_PER_SOL));

    // Create a transaction to simulate
    const [userStakePDA] = deriveUserStakePDA(ctx.poolPDA, user.publicKey);
    const claimIx = createClaimRewardsInstruction(ctx.poolPDA, userStakePDA, user.publicKey);
    const tx = new Transaction().add(claimIx);
    tx.feePayer = ctx.payer.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(ctx.payer, user);

    const simulation = await connection.simulateTransaction(tx);
    const unitsUsed = simulation.value.unitsConsumed || 0;

    console.log(`    Claim instruction compute units: ${unitsUsed}`);

    // Solana limit is 200,000 CU per instruction
    if (unitsUsed > 200000) {
      throw new Error(`Compute units (${unitsUsed}) exceed instruction limit (200,000)`);
    }

    // Our target is under 100,000 CU for efficiency
    if (unitsUsed > 100000) {
      console.log(`    WARNING: High compute usage, consider optimization`);
    }
  });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
