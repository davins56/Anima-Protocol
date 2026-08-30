import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolveDatabaseUrl, resolveDbConfig } from "@workspace/db";
import * as schema from "./schema";

type DbSchema = typeof schema;
type Db = NodePgDatabase<DbSchema>;

/**
 * Legacy webhook DB entrypoint (local `characters` table).
 *
 * Must use the same sslmode stripping + rejectUnauthorized:false behaviour as
 * `@workspace/db` — a raw Pool({ connectionString }) breaks against Replit
 * Postgres from Vercel after pg-connection-string's verify-full change.
 *
 * Pool creation is lazy so Cloudflare Workers can instantiate the module
 * before secrets (DATABASE_URL) are mirrored from env bindings into
 * process.env. Eager createPool() fails Worker version upload with 10021.
 */
function createPool(): Pool {
  const rawUrl = resolveDatabaseUrl();
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

let poolInstance: Pool | null = null;
let dbInstance: Db | null = null;

function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = createPool();
  }
  return poolInstance;
}

function getDb(): Db {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
}

function proxyBind<T extends object>(target: () => T): T {
  return new Proxy({} as T, {
    get(_obj, prop, receiver) {
      const value = Reflect.get(target(), prop, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target())
        : value;
    },
  });
}

export const pool = proxyBind(getPool);
export const db = proxyBind(getDb);
export * from "./schema";
