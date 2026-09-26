import { createDb, reservations, balances } from '@agentos/db';
import { and, eq, lt, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { createService, sweepStuckIdempotency } from '@agentos/server';
import { buildTreasuryRoutes } from './routes.js';
import { registerDevSigner, registerRealSigner, SIGNERS } from './signer.js';
import { loadChainSpecs } from './chains.js';

function registerSigners(): void {
  const mode = process.env.SIGNER_MODE ?? 'dev';
  if (mode === 'real') {
    const seed = process.env.TREASURY_AGENT_SEED;
    const masterKey = process.env.TREASURY_MASTER_PRIVATE_KEY;
    if (!seed) throw new Error('SIGNER_MODE=real requires TREASURY_AGENT_SEED');
    if (!masterKey) throw new Error('SIGNER_MODE=real requires TREASURY_MASTER_PRIVATE_KEY');
    const specs = loadChainSpecs(process.env);
    for (const [chain, spec] of Object.entries(specs)) {
      registerRealSigner(chain, spec, seed, masterKey);
    }
    console.warn('[treasury] REAL signer enabled — broadcasting transactions on-chain. Production requires MPC custody.');
  } else {
    const chains = (process.env.SUPPORTED_CHAINS ?? 'sepolia').split(',');
    for (const chain of chains) registerDevSigner(chain.trim());
  }

  // Legacy compat: wallets provisioned before the base-sepolia → sepolia rename.
  // A dev signer keeps them functional (simulated) instead of returning a 500.
  if (!SIGNERS['base-sepolia']) {
    registerDevSigner('base-sepolia');
    console.warn('[treasury] legacy base-sepolia signer registered (dev fallback) — create agents on "sepolia" for real settlement');
  }
}

async function expireReservations(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
    max: 2,
  });
  const now = new Date();
  const expired = await db.select().from(reservations).where(and(eq(reservations.status, 'held'), lt(reservations.expiresAt, now)));
  for (const r of expired) {
    await db.transaction(async (tx) => {
      await tx.update(reservations).set({ status: 'expired' }).where(eq(reservations.id, r.id));
      await tx
        .update(balances)
        .set({ reservedAmount: sql`reserved_amount - ${r.amount}::numeric` })
        .where(and(eq(balances.walletId, r.walletId), eq(balances.token, r.token)));
    });
  }
  if (expired.length > 0) console.log(`[treasury] expired ${expired.length} reservations`);
}

async function main(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
  });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  registerSigners();

  setInterval(() => {
    expireReservations().catch((err) => console.error('[treasury] expire job failed', err));
    sweepStuckIdempotency(redis).catch((err) => console.error('[treasury] idempotency sweep failed', err));
  }, 5_000);

  await createService({
    name: 'treasury',
    port: Number(process.env.TREASURY_PORT ?? 4002),
    db,
    redis,
    buildRoutes: buildTreasuryRoutes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}