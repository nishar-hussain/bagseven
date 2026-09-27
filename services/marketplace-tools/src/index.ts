import { createDb } from '@agentos/db';
import { Redis } from 'ioredis';
import { createService } from '@agentos/server';
import { buildMarketplaceRoutes } from './routes.js';
import { startMcpServer } from './mcp.js';

async function main(): Promise<void> {
  const db = createDb({
    connectionString: process.env.DATABASE_URL ?? 'postgres://agentos:agentos@localhost:5432/agentos',
  });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  startMcpServer({ db, config: process.env }).catch((err) => {
    console.error('[marketplace] MCP server failed to start', err);
  });

  await createService({
    name: 'marketplace-tools',
    port: Number(process.env.MARKETPLACE_PORT ?? 4005),
    db,
    redis,
    buildRoutes: buildMarketplaceRoutes,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}