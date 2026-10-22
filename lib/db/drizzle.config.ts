import { defineConfig } from "drizzle-kit";
import path from "path";
import { PROTECTED_SQL_TABLES } from "./protected-tables";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  // Tables owned by supabase/migrations/*.sql are NOT in the Drizzle schema.
  // Without this filter `drizzle-kit push` (especially --force) would treat
  // them as stale and DROP them — wiping photos and companion memory.
  tablesFilter: PROTECTED_SQL_TABLES.map((t) => `!${t}`),
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
