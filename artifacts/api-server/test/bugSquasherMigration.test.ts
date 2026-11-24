import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PROTECTED_SQL_TABLES } from "../../../lib/db/protected-tables";

// Static checks on supabase/migrations/20261124010000_bug_squasher.sql.
// Behaviour runs in bugSquasherStore.test.ts against the disposable schema.
const sql = readFileSync(
  new URL("../../../supabase/migrations/20261124010000_bug_squasher.sql", import.meta.url),
  "utf8",
);
const code = sql.replace(/--.*$/gm, "");

describe("bug_squasher migration", () => {
  it("is non-destructive and re-runnable", () => {
    expect(code).toContain("CREATE TABLE IF NOT EXISTS public.bug_reports (");
    expect(code).toContain("CREATE TABLE IF NOT EXISTS public.bug_report_admins (");
    expect(code).not.toMatch(/\bDROP\s+(TABLE|SCHEMA|COLUMN)\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code.match(/CREATE INDEX(?! IF NOT EXISTS)/gi)).toBeNull();
  });

  it("is protected from drizzle push", () => {
    expect(PROTECTED_SQL_TABLES as readonly string[]).toContain("bug_reports");
    expect(PROTECTED_SQL_TABLES as readonly string[]).toContain("bug_report_admins");
  });

  it("has the triage statuses, dedupe key and seen timestamps", () => {
    expect(code).toContain("status IN ('new', 'triaged', 'fixed', 'ignored')");
    expect(code).toContain("UNIQUE (user_id, fingerprint)");
    expect(code).toMatch(/first_seen\s+timestamptz NOT NULL/);
    expect(code).toMatch(/last_seen\s+timestamptz NOT NULL/);
    expect(code).toMatch(/count\s+integer NOT NULL DEFAULT 1/);
  });

  it("turns on RLS with own-row policies and an admin read/update path", () => {
    expect(code).toContain("ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;");
    expect(code).toContain("ALTER TABLE public.bug_report_admins ENABLE ROW LEVEL SECURITY;");
    expect(code).toMatch(/CREATE POLICY bug_reports_select_own[\s\S]*USING \(user_id = \(auth\.jwt\(\) ->> 'sub'\)\)/);
    expect(code).toMatch(/CREATE POLICY bug_reports_insert_own[\s\S]*WITH CHECK \(user_id = \(auth\.jwt\(\) ->> 'sub'\) AND status = 'new'/);
    expect(code).toMatch(/CREATE POLICY bug_reports_select_admin[\s\S]*bug_reports_is_admin\(\)/);
    expect(code).not.toMatch(/FOR DELETE/i);
    expect(code).toContain("REVOKE ALL ON public.bug_report_admins FROM anon, authenticated;");
  });
});
