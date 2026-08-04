import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export const db = drizzle(pool, { schema })
export * from './schema'
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolveDbConfig } from "@workspace/db";
import * as schema from "./schema";

/**
 * Legacy webhook DB entrypoint (local `characters` table).
 *
 * Must use the same sslmode stripping + rejectUnauthorized:false behaviour as
 * `@workspace/db` — a raw Pool({ connectionString }) breaks against Replit
 * Postgres from Vercel after pg-connection-string's verify-full change.
 */
function createPool(): Pool {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const { connectionString, ssl } = resolveDbConfig(rawUrl);
  return new Pool({
    connectionString,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 1),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10_000),
    connectionTimeoutMillis: Number(
      process.env.PG_CONNECTION_TIMEOUT_MS || 8_000,
    ),
    allowExitOnIdle: true,
  });
}

const pool = createPool();
export const db = drizzle(pool, { schema });
export { pool };
export * from "./schema";
