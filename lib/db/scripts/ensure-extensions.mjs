import pg from "pg";

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before ensuring database extensions.");
}

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
} finally {
  await client.end();
}
