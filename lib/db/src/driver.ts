import pg from "pg";
import postgres, { type Sql } from "postgres";

export type DbDriver = "node-pg" | "postgres-js";

export type SqlQueryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

/**
 * Cloudflare Workers identify as `Cloudflare-Workers`. Local Node, Vercel,
 * and Vitest stay on node-postgres.
 */
export function isCloudflareWorkerRuntime(
  global: typeof globalThis = globalThis,
): boolean {
  try {
    const nav = (global as { navigator?: { userAgent?: string } }).navigator;
    return nav?.userAgent === "Cloudflare-Workers";
  } catch {
    return false;
  }
}

/**
 * Worker companion-store path uses postgres.js (Cloudflare + Hyperdrive).
 * Override with ANIMA_DB_DRIVER=postgres-js|node-pg for tests.
 */
export function getDbDriver(
  env: NodeJS.ProcessEnv = process.env,
): DbDriver {
  const override = env.ANIMA_DB_DRIVER?.trim().toLowerCase();
  if (override === "postgres-js" || override === "worker") return "postgres-js";
  if (override === "node-pg" || override === "pg") return "node-pg";
  return isCloudflareWorkerRuntime() ? "postgres-js" : "node-pg";
}

export function createNodePool(
  connectionString: string,
  ssl: false | { rejectUnauthorized: boolean },
): pg.Pool {
  return new pg.Pool({
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

/**
 * Hyperdrive terminates TLS to the origin. The Worker-side connection string
 * is a local proxy — forcing SSL to that socket fails. Origin URLs still use
 * resolveDbConfig's ssl flag (sslmode=require → encrypted, no CA verify).
 */
export function postgresJsSslOption(
  rawUrl: string,
  ssl: false | { rejectUnauthorized: boolean },
): false | { rejectUnauthorized: boolean } {
  if (/hyperdrive/i.test(rawUrl)) return false;
  return ssl;
}

export function createPostgresJsSql(
  rawUrl: string,
  connectionString: string,
  ssl: false | { rejectUnauthorized: boolean },
): Sql {
  const timeoutMs = Number(process.env.PG_CONNECTION_TIMEOUT_MS || 8_000);
  const idleMs = Number(process.env.PG_IDLE_TIMEOUT_MS || 20_000);
  return postgres(connectionString, {
    max: Number(process.env.PG_POOL_MAX || 1),
    // Workers + Hyperdrive / PgBouncer: skip OID prefetch and prepared statements.
    fetch_types: false,
    prepare: false,
    connect_timeout: Math.max(1, Math.round(timeoutMs / 1000)),
    idle_timeout: Math.max(1, Math.round(idleMs / 1000)),
    ssl: postgresJsSslOption(rawUrl, ssl),
  });
}

export function postgresJsQueryable(sql: Sql): SqlQueryable {
  return {
    async query(queryText, values) {
      const rows = values?.length
        ? await sql.unsafe(queryText, values as never[])
        : await sql.unsafe(queryText);
      return { rows: Array.from(rows) as never };
    },
  };
}
