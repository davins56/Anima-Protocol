import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PROTECTED_SQL_TABLES } from "../../../lib/db/protected-tables";

// Static checks on supabase/migrations/20261111020000_tools_guardrails.sql.
// Behaviour (triggers, CHECKs, RLS) was probed on a throwaway Postgres; see
// docs/tools-guardrails.md.
const sql = readFileSync(
  new URL("../../../supabase/migrations/20261111020000_tools_guardrails.sql", import.meta.url),
  "utf8",
);
const TABLES = ["tool_user_settings", "tool_permissions", "tool_pending_confirmations", "tool_action_log"];

describe("tools guardrails migration", () => {
  it("creates the four tables non-destructively", () => {
    for (const t of TABLES) expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bALTER\s+TABLE\s+[^;]*\bDROP\b/i);
  });

  it("registers every new table as protected (drizzle never pushes/drops them)", () => {
    for (const t of TABLES) expect(PROTECTED_SQL_TABLES as readonly string[]).toContain(t);
  });

  it("keeps the action log append-only with the shared trigger function", () => {
    expect(sql).toMatch(/CREATE TRIGGER tool_action_log_immutable\s+BEFORE UPDATE OR DELETE ON public\.tool_action_log\s+FOR EACH ROW EXECUTE FUNCTION public\.anima_forbid_mutation\(\);/);
    expect(sql).toMatch(/CREATE TRIGGER tool_action_log_no_truncate\s+BEFORE TRUNCATE ON public\.tool_action_log\s+FOR EACH STATEMENT EXECUTE FUNCTION public\.anima_forbid_mutation\(\);/);
  });

  it("uses exactly the event list agreed with Builder", () => {
    expect(sql).toContain(
      "'started', 'confirmation_required', 'progress', 'succeeded',\n                     'failed', 'denied', 'expired', 'stopped'",
    );
    expect(sql).toMatch(/seq\s+integer NOT NULL CHECK \(seq >= 1\)/);
    expect(sql).toContain("CONSTRAINT tool_action_log_seq_uq UNIQUE (action_id, seq)");
  });

  it("ties chat-triggered events to the user turn and explicit trigger kinds only", () => {
    expect(sql).toContain("trigger_kind IN ('command', 'button', 'settings_test')");
    expect(sql).toContain("user_message_id IS NOT NULL AND user_message_id = turn_id || ':user'");
    expect(sql).toMatch(/conversation_id\s+text,\s+-- chat_sessions\.id/);
  });

  it("keys permissions per companion with default off", () => {
    expect(sql).toContain("PRIMARY KEY (user_id, character_id, tool)");
    expect(sql).toMatch(/allowed\s+boolean NOT NULL DEFAULT false/);
  });

  it("has no global kill-switch table (it is the ANIMA_TOOLS_KILL Worker setting)", () => {
    expect(sql).not.toMatch(/tool_global_settings/);
    expect(sql).toContain("ANIMA_TOOLS_KILL");
  });

  it("gives confirmations display fields, a sha256 request hash and a one-way guard", () => {
    for (const col of ["target ", "payload_summary ", "amount ", "currency ", "request_hash "]) expect(sql).toContain(`  ${col}`);
    expect(sql).toContain("request_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OR DELETE ON public\.tool_pending_confirmations/);
    expect(sql).toContain("clock_timestamp() >= OLD.expires_at");
  });
});
