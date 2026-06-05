import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

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

const { connectionString, ssl } = resolveDbConfig(rawUrl);

export const pool = new Pool({ connectionString, ssl });
export const db = drizzle(pool, { schema });
