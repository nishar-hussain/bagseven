import { z } from 'zod';

/**
 * Typed, validated environment configuration shared by every service.
 * Config is loaded once at boot; secrets stay out of logs.
 */
export function loadConfig<T extends z.ZodTypeAny>(
  schema: T,
  env: Record<string, string | undefined> = process.env,
): z.infer<T> {
  return schema.parse(env);
}

export const DATABASE_SCHEMA = z.object({
  DATABASE_URL: z.string().min(1).default('postgres://agentos:agentos@localhost:5432/agentos'),
});

export const REDIS_SCHEMA = z.object({
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
});

export const KAFKA_SCHEMA = z.object({
  KAFKA_BROKERS: z.string().default('localhost:9092'),
});

export const PORT_SCHEMA = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
});

export type Env = Record<string, string | undefined>;