import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import {
  createNodePool,
  createPostgresJsSql,
  getDbDriver,
  postgresJsQueryable,
  resolveDatabaseUrl,
  resolveDbConfig,
  type SqlQueryable,
} from "@workspace/db";
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
 * Client creation is lazy so Cloudflare Workers can instantiate the module
 * before secrets (DATABASE_URL / Hyperdrive) are mirrored from env bindings
 * into process.env. Eager createPool() fails Worker version upload with 10021.
 *
 * On the Worker runtime the companion store / this entrypoint use postgres.js
 * (Hyperdrive-safe). Local Node and Vercel keep node-pg.
 */
let queryableInstance: SqlQueryable | null = null;
let dbInstance: Db | null = null;

function getQueryable(): SqlQueryable {
  if (queryableInstance) return queryableInstance;
  const rawUrl = resolveDatabaseUrl();
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const { connectionString, ssl } = resolveDbConfig(rawUrl);
  if (getDbDriver() === "postgres-js") {
    const sql = createPostgresJsSql(rawUrl, connectionString, ssl);
    queryableInstance = postgresJsQueryable(sql);
    dbInstance = drizzlePostgresJs(sql, { schema }) as unknown as Db;
    return queryableInstance;
  }
  const pool = createNodePool(connectionString, ssl);
  queryableInstance = pool;
  dbInstance = drizzle(pool, { schema });
  return queryableInstance;
}

function getDb(): Db {
  if (!dbInstance) getQueryable();
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
