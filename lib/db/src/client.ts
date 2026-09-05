import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import pg from "pg";
import type { Sql } from "postgres";
import * as schema from "./schema";
import {
  createNodePool,
  createPostgresJsSql,
  getDbDriver,
  isCloudflareWorkerRuntime,
  postgresJsQueryable,
  type SqlQueryable,
} from "./driver";

export {
  createNodePool,
  createPostgresJsSql,
  getDbDriver,
  isCloudflareWorkerRuntime,
  postgresJsQueryable,
  postgresJsSslOption,
  type DbDriver,
  type SqlQueryable,
} from "./driver";

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

export interface DbRequestContext {
  epoch: number;
  queryableInstance: SqlQueryable | null;
  dbInstance: Db | null;
  postgresJsSql: Sql | null;
  nodePoolInstance: pg.Pool | null;
  poolConnectionKey: string | null;
}

const dbRequestContextStorage = new AsyncLocalStorage<DbRequestContext>();

let queryableInstance: SqlQueryable | null = null;
let dbInstance: Db | null = null;
let nodePoolInstance: pg.Pool | null = null;
let postgresJsSql: Sql | null = null;
/** Driver + connection string the live client was built with. */
let poolConnectionKey: string | null = null;
/**
 * Request epoch the live client was built in. Cloudflare Workers bind every
 * I/O object (sockets included) to the request context that created it, so a
 * client may never be reused — or torn down — from a later request.
 * See https://developers.cloudflare.com/workers/observability/errors/
 */
let poolRequestEpoch: number | null = null;
let globalRequestEpochCounter = 0;
let currentRequestEpoch = 0;

/**
 * Open a new database request scope using AsyncLocalStorage so concurrent
 * requests on Cloudflare Workers never overwrite or reuse each other's DB client.
 */
export function runWithDbRequestScope<T>(fn: () => T): T {
  globalRequestEpochCounter += 1;
  currentRequestEpoch = globalRequestEpochCounter;
  const ctx: DbRequestContext = {
    epoch: globalRequestEpochCounter,
    queryableInstance: null,
    dbInstance: null,
    postgresJsSql: null,
    nodePoolInstance: null,
    poolConnectionKey: null,
  };
  return dbRequestContextStorage.run(ctx, fn);
}

/**
 * Open a new database request scope. Called once per HTTP request so a cached
 * client is never carried across Worker request contexts. If a callback is
 * provided, it runs inside AsyncLocalStorage.
 */
export function beginDbRequest(): number;
export function beginDbRequest<T>(fn: () => T): T;
export function beginDbRequest<T>(fn?: () => T): number | T {
  if (fn) {
    return runWithDbRequestScope(fn);
  }
  globalRequestEpochCounter += 1;
  currentRequestEpoch = globalRequestEpochCounter;
  return currentRequestEpoch;
}

/** Test helper — the epoch the cached client was created in. */
export function dbRequestEpochForTests(): {
  current: number;
  pool: number | null;
} {
  const store = dbRequestContextStorage.getStore();
  if (store) {
    return {
      current: store.epoch,
      pool: store.queryableInstance ? store.epoch : null,
    };
  }
  return { current: currentRequestEpoch, pool: poolRequestEpoch };
}

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
  "CONNECT_TIMEOUT",
  "CONNECT_ERROR",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
  "CONNECTION_TIMEOUT",
]);

const TRANSIENT_DB_MESSAGE =
  /ECONNRESET|EPIPE|UND_ERR_SOCKET|write CONNECT_|CONNECT_TIMEOUT|CONNECT_ERROR|CONNECTION_ENDED|CONNECTION_DESTROYED|CONNECTION_CLOSED|Connection terminated|Connection ended unexpectedly|Network connection lost|server closed the connection|Client has encountered a connection error|Cannot use a pool after calling end|pool is ended|Client has already been released|timeout expired|connection timeout|ConnectTimeout|SocketTimeout|aborted due to timeout/i;

/**
 * Cloudflare Workers reject any use of an I/O object created in a different
 * request context. A cached Postgres client that leaks across requests fails
 * with this, and it is recoverable: drop the cached client and retry on a
 * fresh one. Matched separately so it also forces a cache discard.
 */
const CROSS_REQUEST_IO_MESSAGE =
  /Cannot perform I\/O on behalf of a different request/i;

/** True for the Workers cross-request I/O violation described above. */
export function isCrossRequestIoError(err: unknown): boolean {
  const { message } = collectDbErrorSignals(err);
  return CROSS_REQUEST_IO_MESSAGE.test(message);
}

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
  if (CROSS_REQUEST_IO_MESSAGE.test(message)) return true;
  return TRANSIENT_DB_MESSAGE.test(message);
}

/** Detach cached clients without touching their sockets. */
function detachCachedClients(): { oldPool: pg.Pool | null; oldSql: Sql | null } {
  const oldPool = nodePoolInstance;
  const oldSql = postgresJsSql;
  queryableInstance = null;
  dbInstance = null;
  nodePoolInstance = null;
  postgresJsSql = null;
  poolConnectionKey = null;
  poolRequestEpoch = null;
  return { oldPool, oldSql };
}

/**
 * Drop cached clients so the next checkout opens a fresh socket.
 *
 * On Cloudflare Workers the client is NOT closed. Calling end() reaches into
 * a socket owned by the request that created it, which throws "Cannot perform
 * I/O on behalf of a different request" (or hangs until the Worker request
 * timeout). The runtime already reclaims those sockets when the owning
 * request finishes, and Hyperdrive returns the upstream connection to its
 * own pool, so detaching is both sufficient and the only safe option.
 *
 * On Node (local dev, Vercel, tests) end() still runs — there the process is
 * long-lived and leaked pools would exhaust Postgres connections.
 */
export function resetPool(): void {
  const store = dbRequestContextStorage.getStore();
  if (store) {
    store.queryableInstance = null;
    store.dbInstance = null;
    store.postgresJsSql = null;
    store.nodePoolInstance = null;
    store.poolConnectionKey = null;
  }
  const { oldPool, oldSql } = detachCachedClients();
  if (isCloudflareWorkerRuntime()) return;

  // Never let a teardown failure escape into the caller's query path.
  if (oldPool) {
    try {
      oldPool.removeAllListeners("error");
      void oldPool.end().catch(() => undefined);
    } catch {
      /* already ended or owned elsewhere */
    }
  }
  if (oldSql) {
    try {
      void oldSql.end({ timeout: 1 }).catch(() => undefined);
    } catch {
      /* already ended or owned elsewhere */
    }
  }
}

/** Test helper — drop cached clients so driver / URL changes take effect. */
export function resetDbClientsForTests(): void {
  resetPool();
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
    if (nodePoolInstance !== pool) return;
    queryableInstance = null;
    dbInstance = null;
    nodePoolInstance = null;
    poolConnectionKey = null;
    poolRequestEpoch = null;
  });
}

export function getPool(): SqlQueryable {
  const rawUrl = resolveDatabaseUrl();
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const { connectionString, ssl } = resolveDbConfig(rawUrl);
  const driverKey = `${getDbDriver()}:${connectionString}`;
  const store = dbRequestContextStorage.getStore();

  if (isCloudflareWorkerRuntime() && store) {
    if (store.queryableInstance && store.poolConnectionKey === driverKey) {
      return store.queryableInstance;
    }
    if (getDbDriver() === "postgres-js") {
      const sql = createPostgresJsSql(rawUrl, connectionString, ssl);
      store.postgresJsSql = sql;
      store.queryableInstance = postgresJsQueryable(sql);
      store.dbInstance = drizzlePostgresJs(sql, { schema }) as unknown as Db;
      store.poolConnectionKey = driverKey;
      return store.queryableInstance;
    }
    const pool = createNodePool(connectionString, ssl);
    store.nodePoolInstance = pool;
    attachPoolGuards(pool);
    store.queryableInstance = pool;
    store.dbInstance = drizzle(pool, { schema });
    store.poolConnectionKey = driverKey;
    return store.queryableInstance;
  }

  // On Workers a client is only reusable inside the request that created it.
  // Hyperdrive also hands out a fresh connection string per request, so the
  // key check alone would usually miss anyway — the epoch check makes the
  // per-request lifetime explicit instead of incidental.
  const sameRequest =
    !isCloudflareWorkerRuntime() || poolRequestEpoch === currentRequestEpoch;

  if (queryableInstance && poolConnectionKey === driverKey && sameRequest) {
    return queryableInstance;
  }
  if (queryableInstance) resetPool();

  if (getDbDriver() === "postgres-js") {
    const sql = createPostgresJsSql(rawUrl, connectionString, ssl);
    postgresJsSql = sql;
    queryableInstance = postgresJsQueryable(sql);
    dbInstance = drizzlePostgresJs(sql, { schema }) as unknown as Db;
    poolConnectionKey = driverKey;
    poolRequestEpoch = currentRequestEpoch;
    return queryableInstance;
  }
  // Vercel Fluid / local Node: tiny node-pg pool, fail fast on a dead DB.
  const pool = createNodePool(connectionString, ssl);
  nodePoolInstance = pool;
  attachPoolGuards(pool);
  queryableInstance = pool;
  dbInstance = drizzle(pool, { schema });
  poolConnectionKey = driverKey;
  poolRequestEpoch = currentRequestEpoch;
  return queryableInstance;
}

function getDb(): Db {
  // Always route through getPool() so the connection-key and request-epoch
  // checks run. Returning a cached dbInstance directly would hand back a
  // drizzle client bound to a previous Worker request's socket.
  getPool();
  const store = dbRequestContextStorage.getStore();
  if (isCloudflareWorkerRuntime() && store?.dbInstance) {
    return store.dbInstance;
  }
  if (!dbInstance) {
    throw new Error("Failed to initialize database client");
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
