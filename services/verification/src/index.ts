import { createDb } from '@agentos/db';
import { Redis } from 'ioredis';
import { createService } from '@agentos/server';
import { buildVerificationRoutes } from './routes.js';

async function main(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
  });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  await createService({
    name: 'verification',
    port: Number(process.env.VERIFICATION_PORT ?? 4004),
    db,
    redis,
    buildRoutes: buildVerificationRoutes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}