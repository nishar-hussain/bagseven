import { createDb } from '@agentos/db';
import { Redis } from 'ioredis';
import { createService } from '@agentos/server';
import { buildDemoProviderRoutes } from './routes.js';

async function main(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
  });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  await createService({
    name: 'demo-provider',
    port: Number(process.env.DEMO_PROVIDER_PORT ?? 4007),
    db,
    redis,
    buildRoutes: buildDemoProviderRoutes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}