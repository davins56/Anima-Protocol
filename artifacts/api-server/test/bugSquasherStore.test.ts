/**
 * Bug Squasher store against real Postgres (the disposable per-run schema
 * from setup-db.ts). Applies supabase/migrations/20261124010000_bug_squasher.sql
 * with `public.` stripped, like calendarAwarenessRoute.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getPool } from "@workspace/db";
import { parseBugReport } from "../src/lib/bugSquasher/ingest";
import {
  BugReportQuotaError,
  MAX_NEW_BUGS_PER_DAY,
  getBugGroupReports,
  ingestBugReport,
  listBugGroups,
  listMyBugReports,
  setBugGroupStatus,
} from "../src/lib/bugSquasher/store";

const migrationSql = readFileSync(
  new URL("../../../supabase/migrations/20261124010000_bug_squasher.sql", import.meta.url),
  "utf8",
);

const crash = (message = "TypeError: boom", extra: Record<string, unknown> = {}) =>
  parseBugReport({
    kind: "react_crash",
    message,
    stack: "at Chat (https://a.com/assets/Chat-ABCDEF12.js:1:1)",
    route: "/chat/s1",
    app_version: "c9d2565a",
    context: { breadcrumbs: [{ type: "nav", message: "/chat/s1" }] },
    ...extra,
  });

beforeAll(async () => {
  // Re-runnable: applying twice must not fail.
  await getPool().query(migrationSql.replace(/public\./g, ""));
  await getPool().query(migrationSql.replace(/public\./g, ""));
});

beforeEach(async () => {
  await getPool().query("DELETE FROM bug_reports");
});

describe("bug squasher store (real Postgres)", () => {
  it("dedupes repeats of one bug for one user into one row with a count", async () => {
    const first = await ingestBugReport("user_a", crash());
    const second = await ingestBugReport("user_a", crash("TypeError: boom"));
    const third = await ingestBugReport("user_a", { ...crash(), occurrences: 5 });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(third.count).toBe(7);
    expect(second.id).toBe(first.id);
    const rows = await getBugGroupReports(first.fingerprint);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]!.last_seen).getTime()).toBeGreaterThanOrEqual(new Date(rows[0]!.first_seen).getTime());
  });

  it("groups the same bug across users for triage", async () => {
    await ingestBugReport("user_a", crash());
    await ingestBugReport("user_b", crash());
    await ingestBugReport("user_b", crash());
    await ingestBugReport("user_b", crash("RangeError: other"));
    const groups = await listBugGroups({});
    const boom = groups.find((g) => g.message === "TypeError: boom")!;
    expect(boom.total_count).toBe(3);
    expect(boom.user_count).toBe(2);
    expect(boom.status).toBe("new");
    expect(groups).toHaveLength(2);
  });

  it("users see only their own reports", async () => {
    await ingestBugReport("user_a", crash());
    await ingestBugReport("user_b", crash("RangeError: other"));
    const mine = await listMyBugReports("user_a");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.title).toBe("TypeError: boom");
  });

  it("status changes apply to the whole group; filters work", async () => {
    const r = await ingestBugReport("user_a", crash());
    await ingestBugReport("user_b", crash());
    expect(await setBugGroupStatus(r.fingerprint, "triaged", { note: "looking", actor: "admin_1" })).toBe(2);
    expect((await listBugGroups({ status: "triaged" }))[0]!.admin_note).toBe("looking");
    expect(await listBugGroups({ status: "new" })).toHaveLength(0);
    // A new user's report joins as triaged, not as a fresh 'new' group.
    const joined = await ingestBugReport("user_c", crash());
    expect(joined.status).toBe("triaged");
  });

  it("a fixed bug that recurs reopens automatically", async () => {
    const r = await ingestBugReport("user_a", crash());
    await setBugGroupStatus(r.fingerprint, "fixed", { note: "PR #781", actor: "admin_1" });
    expect((await listBugGroups({ status: "fixed" }))).toHaveLength(1);
    const again = await ingestBugReport("user_a", crash());
    expect(again.status).toBe("new");
    expect(again.reopened).toBe(true);
    expect(again.reopen_count).toBe(1);
    const [row] = await getBugGroupReports(r.fingerprint);
    expect(row!.status_changed_by).toBe("auto:recurred");
    expect((await listBugGroups({ status: "new" }))[0]!.reopen_count).toBe(1);
  });

  it("a fixed bug hit by a different user also reopens the group", async () => {
    const r = await ingestBugReport("user_a", crash());
    await setBugGroupStatus(r.fingerprint, "fixed", { note: null, actor: "admin_1" });
    const other = await ingestBugReport("user_b", crash());
    expect(other.status).toBe("new");
    expect(other.reopened).toBe(true);
    expect((await listBugGroups({}))[0]!.status).toBe("new");
  });

  it("ignored bugs stay ignored on repeat and for new users", async () => {
    const r = await ingestBugReport("user_a", crash());
    await setBugGroupStatus(r.fingerprint, "ignored", { note: "extension noise", actor: "admin_1" });
    expect((await ingestBugReport("user_a", crash())).status).toBe("ignored");
    expect((await ingestBugReport("user_b", crash())).status).toBe("ignored");
  });

  it("keeps a manual report's description and screenshot", async () => {
    const shot = `data:image/jpeg;base64,${"A".repeat(200)}`;
    const r = await ingestBugReport(
      "user_a",
      parseBugReport({ kind: "manual", description: "The send button stopped working", screenshot: shot, route: "/chat" }),
    );
    const [row] = await getBugGroupReports(r.fingerprint);
    expect(row!.description).toBe("The send button stopped working");
    expect(row!.has_screenshot).toBe(true);
    expect(r.fingerprint).toMatch(/^m_/);
  });

  it("caps distinct new bugs per user per day but still counts repeats", async () => {
    const values = Array.from({ length: MAX_NEW_BUGS_PER_DAY }, (_, i) => `('user_q', 'a_quota${String(i).padStart(6, "0")}', 'window_error', 't')`);
    await getPool().query(`INSERT INTO bug_reports (user_id, fingerprint, kind, title) VALUES ${values.join(",")}`);
    await expect(ingestBugReport("user_q", crash("Brand new error"))).rejects.toBeInstanceOf(BugReportQuotaError);
    // A repeat of an existing row is not blocked.
    await getPool().query(`UPDATE bug_reports SET fingerprint = $1 WHERE fingerprint = 'a_quota000000'`, [crash().fingerprint]);
    expect((await ingestBugReport("user_q", crash())).count).toBe(2);
  });

  it("the table rejects bad statuses, kinds and fingerprints", async () => {
    await expect(
      getPool().query(`INSERT INTO bug_reports (user_id, fingerprint, kind, title, status) VALUES ('u', 'a_12345678', 'manual', 't', 'done')`),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      getPool().query(`INSERT INTO bug_reports (user_id, fingerprint, kind, title) VALUES ('u', 'a_12345678', 'nope', 't')`),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      getPool().query(`INSERT INTO bug_reports (user_id, fingerprint, kind, title) VALUES ('u', 'BAD FP', 'manual', 't')`),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
