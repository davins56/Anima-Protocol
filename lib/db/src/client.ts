import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

type DbSchema = typeof schema;
type Db = NodePgDatabase<DbSchema>;

/**
 * Resolve SSL behaviour from the URL's `sslmode`, then strip `sslmode` from the
 * connection string so node-postgres' own parser does not re-apply it.
 *
 * Why: pg-connection-string now treats `sslmode=require` (and `prefer` /
 * `verify-ca`) as `verify-full`, which verifies the server certificate against
 * the system CA store. Replit's managed Postgres presents a certificate that is
 * not in that store, so on the production database (which connects with
 * `sslmode=require`) every connection — and therefore every query — fails. We
 * keep the connection encrypted but skip CA verification, which is the
 * long-standing meaning of `sslmode=require` in this environment.
 * `sslmode=disable` (used in development) stays an unencrypted connection.
 *
 * Important: strip via regex only. `new URL(...).toString()` re-encodes
 * passwords (`=` → `%3D`, etc.) and can break authentication against the
 * original DATABASE_URL secret.
 */
export function resolveDbConfig(url: string): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
} {
  const match = url.match(/[?&]sslmode=([^&]*)/i);
  const sslmode = match ? decodeURIComponent(match[1]) : null;
  let connectionString = url.replace(
    /([?&])sslmode=[^&]*(&|$)/i,
    (_full, lead: string, trail: string) => {
      if (trail === "&") return lead; // keep ? or & for the next param
      return ""; // drop trailing ?sslmode=... or &sslmode=...
    },
  );
  // If we removed the only query param, we may leave a dangling '?'.
  connectionString = connectionString.replace(/\?$/, "").replace(/[?&]$/, "");

  const ssl = sslmode === "disable" ? false : { rejectUnauthorized: false };
  return { connectionString, ssl };
}

let poolInstance: pg.Pool | null = null;
let dbInstance: Db | null = null;

export const DATABASE_URL_ENV_NAMES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "PRISMA_DATABASE_URL",
] as const;

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of DATABASE_URL_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getPool(): pg.Pool {
  if (poolInstance) return poolInstance;
  const rawUrl = resolveDatabaseUrl();
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const { connectionString, ssl } = resolveDbConfig(rawUrl);
  // Vercel Fluid / serverless: keep the pool tiny and fail fast so a dead DB
  // surfaces as 503 quickly instead of hanging the Character list request.
  poolInstance = new Pool({
    connectionString,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 1),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10_000),
    connectionTimeoutMillis: Number(
      process.env.PG_CONNECTION_TIMEOUT_MS || 8_000,
    ),
    allowExitOnIdle: true,
  });
  return poolInstance;
}

function getDb(): Db {
  if (dbInstance) return dbInstance;
  dbInstance = drizzle(getPool(), { schema });
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
