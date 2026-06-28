import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

type DbSchema = typeof schema;
type Db = NodePgDatabase<DbSchema>;

// Resolve SSL behaviour from the URL's `sslmode`, then strip `sslmode` from the
// connection string so node-postgres' own parser does not re-apply it.
//
// Why: pg-connection-string now treats `sslmode=require` (and `prefer` /
// `verify-ca`) as `verify-full`, which verifies the server certificate against
// the system CA store. Replit's managed Postgres presents a certificate that is
// not in that store, so on the production database (which connects with
// `sslmode=require`) every connection — and therefore every query — fails. We
// keep the connection encrypted but skip CA verification, which is the
// long-standing meaning of `sslmode=require` in this environment.
// `sslmode=disable` (used in development) stays an unencrypted connection.
function resolveDbConfig(url: string): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
} {
  let sslmode: string | null = null;
  let connectionString = url;
  try {
    const parsed = new URL(url);
    sslmode = parsed.searchParams.get("sslmode");
    parsed.searchParams.delete("sslmode");
    connectionString = parsed.toString();
  } catch {
    const m = url.match(/[?&]sslmode=([^&]+)/);
    sslmode = m ? m[1] : null;
    connectionString = url.replace(
      /([?&])sslmode=[^&]+(&|$)/,
      (_match, lead: string, trail: string) => (trail === "&" ? lead : ""),
    );
  }
  const ssl = sslmode === "disable" ? false : { rejectUnauthorized: false };
  return { connectionString, ssl };
}

let poolInstance: pg.Pool | null = null;
let dbInstance: Db | null = null;

export function getPool(): pg.Pool {
  if (poolInstance) return poolInstance;
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  const { connectionString, ssl } = resolveDbConfig(rawUrl);
  poolInstance = new Pool({ connectionString, ssl });
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
