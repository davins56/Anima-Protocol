/**
 * Static checks for Migration S1 (supabase/migrations/20261115120000_aetherial_net.sql).
 * No database: the DB-backed tests (apply twice, guards raise 42501, rollback on an
 * empty schema, write-path concurrency) belong to SL-4 (Backend Data).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_SQL_TABLES } from "../protected-tables";

const root = join(__dirname, "../../..");
const up = readFileSync(join(root, "supabase/migrations/20261115120000_aetherial_net.sql"), "utf8");
const down = readFileSync(join(root, "supabase/rollback/20261115120000_aetherial_net.down.sql"), "utf8");
const strip = (sql: string) => sql.replace(/--.*$/gm, "");
const UP = strip(up);
const DOWN = strip(down);

const TABLES = [
  "aetherial_net_access_log",
  "aetherial_net_events",
  "aetherial_net_progress",
  "aetherial_net_dissonance",
  "aetherial_net_inventory",
  "aetherial_net_reward_claims",
  "aetherial_net_cap_counters",
];
const APPEND_ONLY = ["aetherial_net_access_log", "aetherial_net_events", "aetherial_net_reward_claims"];

describe("Migration S1 (aetherial_net) static shape", () => {
  it("guards the domain with to_regtype so a CI-schema re-run works (N1)", () => {
    expect(UP).toContain("IF to_regtype('public.aetherial_net_stratum') IS NULL THEN");
    expect(UP).not.toMatch(/nspname\s*=\s*'public'/);
    // CI applies the file with "public." stripped into a disposable schema.
    const ci = UP.replace(/public\./g, "");
    expect(ci).toContain("IF to_regtype('aetherial_net_stratum') IS NULL THEN");
    expect(ci).not.toMatch(/\bpublic\./);
  });

  it("creates exactly the 7 tables, each with IF NOT EXISTS (B1)", () => {
    const created = [...UP.matchAll(/CREATE TABLE\s+(IF NOT EXISTS\s+)?public\.([a-z_]+)/gi)];
    expect(created.map((m) => m[2]).sort()).toEqual([...TABLES].sort());
    for (const m of created) expect(m[1], m[2]).toBeTruthy();
    for (const m of UP.matchAll(/CREATE (UNIQUE )?INDEX\s+(IF NOT EXISTS\s+)?([a-z_]+)/gi)) expect(m[2], m[3]).toBeTruthy();
  });

  it("drops every trigger before re-creating it (B1)", () => {
    for (const m of UP.matchAll(/CREATE TRIGGER\s+([a-z_]+)\s+[\s\S]*?ON\s+public\.([a-z_]+)/gi)) {
      expect(UP).toContain(`DROP TRIGGER IF EXISTS ${m[1]} ON public.${m[2]};`);
    }
  });

  it("guards UPDATE/DELETE and TRUNCATE on every append-only ledger with no bypass (c)", () => {
    for (const t of APPEND_ONLY) {
      expect(UP).toMatch(new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${t}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.aetherial_net_forbid_mutation\\(\\)`));
      expect(UP).toMatch(new RegExp(`BEFORE TRUNCATE ON public\\.${t}\\s+FOR EACH STATEMENT EXECUTE FUNCTION public\\.aetherial_net_forbid_mutation\\(\\)`));
    }
    const fn = /FUNCTION public\.aetherial_net_forbid_mutation\(\)[\s\S]*?END \$\$;/.exec(UP)?.[0] ?? "";
    expect(fn).toMatch(/RAISE EXCEPTION/);
    expect(fn).not.toMatch(/\bIF\b|current_setting|current_user|session_user|RETURN /i);
    expect(UP).not.toMatch(/anima_forbid_mutation/); // never redefines the shared guard
  });

  it("stores dedupe key + request hash on every mutating table (B2)", () => {
    for (const t of TABLES.filter((x) => x !== "aetherial_net_access_log")) {
      const body = new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(([\\s\\S]*?)\\n\\);`).exec(UP)?.[1] ?? "";
      expect(body, t).toMatch(/dedupe_key\s+text/);
      expect(body, t).toMatch(/request_hash\s+text/);
    }
    expect(UP).toMatch(/aetherial_net_events_dedupe_uq UNIQUE \(user_id, dedupe_key\)/);
  });

  it("enables RLS and revokes client roles on all 7 tables (B3)", () => {
    for (const t of TABLES) expect(UP).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
    expect(UP).toMatch(/REVOKE ALL ON public\.%I FROM authenticated/);
    expect(UP).toMatch(/REVOKE ALL ON public\.%I FROM anon/);
    for (const t of TABLES) expect(UP.match(new RegExp(`'${t}'`, "g"))?.length ?? 0, t).toBeGreaterThanOrEqual(1);
  });

  it("types every stratum column with the one domain", () => {
    const strata = [...UP.matchAll(/^\s*stratum\s+(\S+)/gm)].map((m) => m[1]);
    expect(strata).toHaveLength(TABLES.length);
    for (const s of strata) expect(s).toBe("public.aetherial_net_stratum");
  });

  it("is non-destructive", () => {
    expect(UP).not.toMatch(/\b(DROP\s+TABLE|TRUNCATE\s+public|DELETE\s+FROM|DROP\s+COLUMN|DISABLE\s+TRIGGER)\b/i);
  });

  it("lists all 7 tables in PROTECTED_SQL_TABLES (a)", () => {
    for (const t of TABLES) expect(PROTECTED_SQL_TABLES as readonly string[]).toContain(t);
  });

  it("has a rollback that refuses non-empty tables and drops everything S1 created (B4)", () => {
    expect(DOWN).toMatch(/RAISE EXCEPTION 'aetherial_net rollback refused/);
    for (const t of TABLES) expect(DOWN).toContain(`DROP TABLE IF EXISTS public.${t};`);
    expect(DOWN).toContain("DROP FUNCTION IF EXISTS public.aetherial_net_forbid_mutation();");
    expect(DOWN).toContain("DROP DOMAIN IF EXISTS public.aetherial_net_stratum;");
    // N2: one transaction, each table locked before its emptiness check.
    expect(DOWN.trim().startsWith("BEGIN;")).toBe(true);
    expect(DOWN.trim().endsWith("COMMIT;")).toBe(true);
    const lockAt = DOWN.indexOf("LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE");
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(DOWN.indexOf("SELECT count(*)"));
    expect(DOWN.indexOf("BEGIN;")).toBeLessThan(lockAt);
    expect(DOWN.lastIndexOf("COMMIT;")).toBeGreaterThan(DOWN.indexOf("DROP DOMAIN"));
    // FK dependents are dropped before the events table.
    expect(DOWN.indexOf("public.aetherial_net_reward_claims;")).toBeLessThan(DOWN.indexOf("public.aetherial_net_events;"));
    expect(DOWN.indexOf("public.aetherial_net_dissonance;")).toBeLessThan(DOWN.indexOf("public.aetherial_net_events;"));
  });
});
