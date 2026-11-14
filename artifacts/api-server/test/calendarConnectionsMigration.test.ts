import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PROTECTED_SQL_TABLES } from "../../../lib/db/protected-tables";

// Static checks on supabase/migrations/20261114020000_calendar_connections.sql.
// Behaviour runs in calendarAwarenessRoute.test.ts against the disposable schema.
const sql = readFileSync(
  new URL("../../../supabase/migrations/20261114020000_calendar_connections.sql", import.meta.url),
  "utf8",
);
const code = sql.replace(/--.*$/gm, "");

describe("calendar_connections migration", () => {
  it("creates one table non-destructively", () => {
    expect(code).toContain("CREATE TABLE IF NOT EXISTS public.calendar_connections (");
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+public\./i);
    expect(code.match(/\bCREATE TABLE\b/gi)).toHaveLength(1);
  });

  it("is protected from drizzle push", () => {
    expect(PROTECTED_SQL_TABLES as readonly string[]).toContain("calendar_connections");
  });

  it("stores only an encrypted refresh token, never titles, emails or access tokens", () => {
    expect(code).toContain("refresh_token_enc  text NOT NULL CHECK (refresh_token_enc ~ '^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$')");
    expect(code).not.toMatch(/\b(title|subject|summary|email|access_token|calendar_id)\b/i);
    expect(code).toContain("PRIMARY KEY (user_id, provider)");
    expect(code).toContain("provider IN ('google', 'microsoft')");
  });

  it("is server-only: RLS on, no policies, client roles revoked", () => {
    expect(code).toContain("ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;");
    expect(code).not.toMatch(/CREATE POLICY/i);
    expect(code).toContain("REVOKE ALL ON public.calendar_connections FROM authenticated;");
    expect(code).toContain("REVOKE ALL ON public.calendar_connections FROM anon;");
  });
});
