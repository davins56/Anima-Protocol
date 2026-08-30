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
/** Connection string the live pool was built with — recreate if Hyperdrive/URL changes. */
let poolConnectionKey: string | null = null;

export const DATABASE_URL_ENV_NAMES = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "PRISMA_DATABASE_URL",
] as const;

const RUNTIME_ENV_READER = Symbol.for("anima.cloudflare.readRuntimeEnv");

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of DATABASE_URL_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  const reader = (globalThis as Record<PropertyKey, unknown>)[
    RUNTIME_ENV_READER
  ];
  if (typeof reader === "function") {
    for (const name of DATABASE_URL_ENV_NAMES) {
      const extra = String(
        (reader as (n: string) => unknown)(name) ?? "",
      ).trim();
      if (extra) return extra;
    }
  }
  return undefined;
}

const TRANSIENT_DB_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ETIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "ABORT_ERR",
]);

const TRANSIENT_DB_MESSAGE =
  /ECONNRESET|EPIPE|UND_ERR_SOCKET|Connection terminated|Connection ended unexpectedly|Network connection lost|server closed the connection|Client has encountered a connection error|Cannot use a pool after calling end|pool is ended|Client has already been released|timeout expired|connection timeout|ConnectTimeout|SocketTimeout|aborted due to timeout/i;

/** Walk Error.cause so drizzle "Failed query" wrappers still expose ECONNRESET. */
function collectDbErrorSignals(err: unknown): { message: string; codes: string[] } {
  const messages: string[] = [];
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (current instanceof Error) messages.push(current.message);
    else if (typeof current === "string") messages.push(current);
    if (current && typeof current === "object" && "code" in current) {
      const code = String((current as { code?: unknown }).code ?? "");
      if (code) codes.push(code);
    }
    current =
      current && typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return { message: messages.join("\n"), codes };
}

/**
 * True for stale / dropped Postgres sockets — the usual Cloudflare Worker +
 * serverless pooler failure when an idle client is reused after the origin
 * reset the TCP connection. Do not treat auth or missing-schema as transient.
 */
export function isTransientDbError(err: unknown): boolean {
  const { message, codes } = collectDbErrorSignals(err);
  if (codes.some((code) => TRANSIENT_DB_CODES.has(code))) return true;
  return TRANSIENT_DB_MESSAGE.test(message);
}

/** Drop the process-wide pool so the next checkout opens a fresh socket. */
export function resetPool(): void {
  const old = poolInstance;
  poolInstance = null;
  dbInstance = null;
  poolConnectionKey = null;
  if (!old) return;
  old.removeAllListeners("error");
  void old.end().catch(() => undefined);
}

export async function withTransientDbRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt === attempts) throw err;
      resetPool();
      await new Promise((resolve) =>
        setTimeout(resolve, 40 * 2 ** (attempt - 1)),
      );
    }
  }
  throw lastErr;
}

function attachPoolGuards(pool: pg.Pool): void {
  pool.on("error", () => {
    // Idle client died (ECONNRESET / terminate). Detach so the next getPool()
    // opens a fresh socket. Do not end() here — that races in-flight queries
    // into "Cannot use a pool after calling end".
    if (poolInstance !== pool) return;
    poolInstance = null;
    dbInstance = null;
    poolConnectionKey = null;
  });
}

export function getPool(): pg.Pool {
  const rawUrl = resolveDatabaseUrl();
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const { connectionString, ssl } = resolveDbConfig(rawUrl);
  if (poolInstance && poolConnectionKey === connectionString) {
    return poolInstance;
  }
  if (poolInstance) resetPool();
  // Serverless / Workers reuse isolates; origin poolers (Supavisor, Neon,
  // Hyperdrive, PgBouncer) drop idle TCP well under the old 10s default.
  // Keep the pool tiny and fail fast so a dead DB surfaces as 503 quickly.
  poolInstance = new Pool({
    connectionString,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 1),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 2_000),
    connectionTimeoutMillis: Number(
      process.env.PG_CONNECTION_TIMEOUT_MS || 8_000,
    ),
    maxLifetimeSeconds: Number(process.env.PG_MAX_LIFETIME_SECONDS || 60),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    allowExitOnIdle: true,
  });
  poolConnectionKey = connectionString;
  attachPoolGuards(poolInstance);
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
