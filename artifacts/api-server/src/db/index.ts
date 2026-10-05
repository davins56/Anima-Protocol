import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import {
  createNodePool,
  createPostgresJsSql,
  getDbDriver,
  getDbRequestEpoch,
  isCloudflareWorkerRuntime,
  postgresJsQueryable,
  resolveDatabaseUrl,
  resolveDbConfig,
  type SqlQueryable,
} from "@workspace/db";
import * as schema from "./schema";

type DbSchema = typeof schema;
type Db = NodePgDatabase<DbSchema>;

/**
 * Legacy webhook DB entrypoint (local `characters` / anima_* tables).
 *
 * Must use the same sslmode stripping + rejectUnauthorized:false behaviour as
 * `@workspace/db` — a raw Pool({ connectionString }) breaks against Replit
 * Postgres from Vercel after pg-connection-string's verify-full change.
 *
 * Client creation is lazy so Cloudflare Workers can instantiate the module
 * before secrets (DATABASE_URL / Hyperdrive) are mirrored from env bindings
 * into process.env. Eager createPool() fails Worker version upload with 10021.
 *
 * On the Worker runtime the companion store / this entrypoint use postgres.js
 * (Hyperdrive-safe). Local Node and Vercel keep node-pg.
 *
 * Workers bind every socket to the request that created it. Chat loads
 * evolution / relationship / arc through this client *after* the typing
 * indicator is on screen. Reusing a previous request's postgres.js instance
 * throws "Cannot perform I/O on behalf of a different request", which
 * classifyDbError maps to the HUD toast "Database unavailable". Isolate the
 * client per request epoch — same rule as `@workspace/db`.
 */
let queryableInstance: SqlQueryable | null = null;
let dbInstance: Db | null = null;
let poolRequestEpoch: number | null = null;
let poolConnectionKey: string | null = null;

function detachCachedClients(): void {
  queryableInstance = null;
  dbInstance = null;
  poolRequestEpoch = null;
  poolConnectionKey = null;
}

function getQueryable(): SqlQueryable {
  const rawUrl = resolveDatabaseUrl();
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const { connectionString, ssl } = resolveDbConfig(rawUrl);
  const driverKey = `${getDbDriver()}:${connectionString}`;
  const epoch = getDbRequestEpoch();
  const sameRequest =
    !isCloudflareWorkerRuntime() || poolRequestEpoch === epoch;

  if (queryableInstance && poolConnectionKey === driverKey && sameRequest) {
    return queryableInstance;
  }
  // Drop the previous request's client without end() — closing a Worker
  // socket from a later request is itself a cross-request I/O violation.
  detachCachedClients();

  if (getDbDriver() === "postgres-js") {
    const sql = createPostgresJsSql(rawUrl, connectionString, ssl);
    queryableInstance = postgresJsQueryable(sql);
    dbInstance = drizzlePostgresJs(sql, { schema }) as unknown as Db;
    poolConnectionKey = driverKey;
    poolRequestEpoch = epoch;
    return queryableInstance;
  }
  const pool = createNodePool(connectionString, ssl);
  queryableInstance = pool;
  dbInstance = drizzle(pool, { schema });
  poolConnectionKey = driverKey;
  poolRequestEpoch = epoch;
  return queryableInstance;
}

function getDb(): Db {
  // Always route through getQueryable() so the request-epoch check runs.
  // Returning a cached dbInstance here reused the previous chat turn's
  // Hyperdrive socket and surfaced as "Database unavailable" mid-wait.
  getQueryable();
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

export const pool = proxyBind(getQueryable);
export const db = proxyBind(getDb);
export * from "./schema";
