/**
 * Postgres access for Bug Squasher (supabase/migrations/20261124010000_bug_squasher.sql).
 *
 * One row per (user_id, fingerprint). Ingest is a single upsert so two tabs
 * reporting the same bug at once cannot create duplicates:
 *   - new row: inherits the group's open status (triaged stays triaged,
 *     ignored stays ignored); a group that was fixed comes back as 'new'.
 *   - existing row: count += occurrences, last_seen = now(); a fixed row
 *     reopens as 'new' (reopen_count + 1).
 */
import { getPool } from "@workspace/db";
import type { BugReportInput, BugStatus } from "./ingest";

/** Distinct new bugs one user may open per 24h (repeats are free). */
export const MAX_NEW_BUGS_PER_DAY = 200;

export class BugSquasherSchemaMissingError extends Error {
  code = "bug_squasher_schema_missing";
  constructor() {
    super("Bug Squasher is not migrated yet.");
  }
}

export class BugReportQuotaError extends Error {
  code = "bug_report_quota";
  constructor() {
    super("Too many new bug reports today.");
  }
}

export function isMissingSchema(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "42P01" || code === "42703";
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingSchema(err)) throw new BugSquasherSchemaMissingError();
    throw err;
  }
}

export type IngestResult = {
  id: string;
  fingerprint: string;
  status: BugStatus;
  count: number;
  reopen_count: number;
  inserted: boolean;
  reopened: boolean;
};

export async function ingestBugReport(userId: string, input: BugReportInput): Promise<IngestResult> {
  return run(async () => {
    const pool = getPool();
    const { rows: existing } = await pool.query<{ exists: boolean; recent: number }>(
      `SELECT EXISTS (SELECT 1 FROM bug_reports WHERE user_id = $1 AND fingerprint = $2) AS exists,
              (SELECT count(*)::int FROM bug_reports
                WHERE user_id = $1 AND first_seen > now() - interval '1 day') AS recent`,
      [userId, input.fingerprint],
    );
    const facts = existing[0];
    if (facts && !facts.exists && Number(facts.recent) >= MAX_NEW_BUGS_PER_DAY) {
      throw new BugReportQuotaError();
    }

    const { rows } = await pool.query<IngestResult>(
      `WITH grp AS (
         SELECT coalesce(bool_or(status = 'new'), false)     AS any_new,
                coalesce(bool_or(status = 'triaged'), false) AS any_triaged,
                coalesce(bool_or(status = 'fixed'), false)   AS any_fixed,
                coalesce(bool_or(status = 'ignored'), false) AS any_ignored
           FROM bug_reports WHERE fingerprint = $2
       )
       INSERT INTO bug_reports AS b
         (user_id, fingerprint, kind, status, title, message, stack, route, app_version,
          user_agent, description, context, screenshot, count, reopen_count, reopened_at)
       SELECT $1, $2, $3,
              CASE WHEN grp.any_new THEN 'new'
                   WHEN grp.any_triaged THEN 'triaged'
                   WHEN grp.any_fixed THEN 'new'
                   WHEN grp.any_ignored THEN 'ignored'
                   ELSE 'new' END,
              $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
              CASE WHEN grp.any_fixed AND NOT grp.any_new AND NOT grp.any_triaged THEN 1 ELSE 0 END,
              CASE WHEN grp.any_fixed AND NOT grp.any_new AND NOT grp.any_triaged THEN now() END
         FROM grp
       ON CONFLICT (user_id, fingerprint) DO UPDATE SET
         count        = LEAST(b.count + EXCLUDED.count, 2000000000),
         last_seen    = now(),
         title        = EXCLUDED.title,
         message      = coalesce(EXCLUDED.message, b.message),
         stack        = coalesce(EXCLUDED.stack, b.stack),
         route        = coalesce(EXCLUDED.route, b.route),
         app_version  = coalesce(EXCLUDED.app_version, b.app_version),
         user_agent   = coalesce(EXCLUDED.user_agent, b.user_agent),
         description  = coalesce(EXCLUDED.description, b.description),
         context      = EXCLUDED.context,
         screenshot   = coalesce(EXCLUDED.screenshot, b.screenshot),
         status       = CASE WHEN b.status = 'fixed' THEN 'new' ELSE b.status END,
         reopen_count = b.reopen_count + CASE WHEN b.status = 'fixed' THEN 1 ELSE 0 END,
         reopened_at  = CASE WHEN b.status = 'fixed' THEN now() ELSE b.reopened_at END,
         status_changed_at = CASE WHEN b.status = 'fixed' THEN now() ELSE b.status_changed_at END,
         status_changed_by = CASE WHEN b.status = 'fixed' THEN 'auto:recurred' ELSE b.status_changed_by END,
         updated_at   = now()
       RETURNING id, fingerprint, status, count, reopen_count,
                 (xmax = 0) AS inserted,
                 (reopened_at IS NOT NULL AND reopened_at = now()) AS reopened`,
      [
        userId,
        input.fingerprint,
        input.kind,
        input.title,
        input.message,
        input.stack,
        input.route,
        input.appVersion,
        input.userAgent,
        input.description,
        JSON.stringify(input.context),
        input.screenshot,
        input.occurrences,
      ],
    );
    const row = rows[0]!;
    return { ...row, count: Number(row.count), reopen_count: Number(row.reopen_count) };
  });
}

export type MyBugReport = {
  id: string;
  kind: string;
  status: BugStatus;
  title: string;
  count: number;
  first_seen: string;
  last_seen: string;
};

export async function listMyBugReports(userId: string, limit = 50): Promise<MyBugReport[]> {
  return run(async () => {
    const { rows } = await getPool().query<MyBugReport>(
      `SELECT id, kind, status, title, count, first_seen, last_seen
         FROM bug_reports WHERE user_id = $1
        ORDER BY last_seen DESC LIMIT $2`,
      [userId, Math.min(Math.max(1, limit), 100)],
    );
    return rows.map((r) => ({ ...r, count: Number(r.count) }));
  });
}

export type BugGroup = {
  fingerprint: string;
  status: BugStatus;
  kind: string;
  title: string;
  message: string | null;
  route: string | null;
  app_version: string | null;
  total_count: number;
  user_count: number;
  reopen_count: number;
  first_seen: string;
  last_seen: string;
  has_screenshot: boolean;
  admin_note: string | null;
};

/** Group status: the most urgent status among its rows. */
const GROUP_STATUS_SQL = `CASE WHEN bool_or(status = 'new') THEN 'new'
                               WHEN bool_or(status = 'triaged') THEN 'triaged'
                               WHEN bool_or(status = 'fixed') THEN 'fixed'
                               ELSE 'ignored' END`;

export async function listBugGroups(opts: {
  status?: BugStatus | null;
  q?: string | null;
  limit?: number;
}): Promise<BugGroup[]> {
  return run(async () => {
    const q = (opts.q || "").trim().slice(0, 100);
    const { rows } = await getPool().query<BugGroup>(
      `SELECT fingerprint,
              ${GROUP_STATUS_SQL} AS status,
              (array_agg(kind ORDER BY last_seen DESC))[1] AS kind,
              (array_agg(title ORDER BY last_seen DESC))[1] AS title,
              (array_agg(message ORDER BY last_seen DESC))[1] AS message,
              (array_agg(route ORDER BY last_seen DESC))[1] AS route,
              (array_agg(app_version ORDER BY last_seen DESC))[1] AS app_version,
              sum(count)::bigint AS total_count,
              count(*)::int AS user_count,
              sum(reopen_count)::int AS reopen_count,
              min(first_seen) AS first_seen,
              max(last_seen) AS last_seen,
              bool_or(screenshot IS NOT NULL) AS has_screenshot,
              (array_agg(admin_note ORDER BY status_changed_at DESC NULLS LAST))[1] AS admin_note
         FROM bug_reports
        WHERE ($2::text = '' OR title ILIKE '%' || $2 || '%' OR message ILIKE '%' || $2 || '%'
               OR route ILIKE '%' || $2 || '%' OR fingerprint = $2)
        GROUP BY fingerprint
       HAVING ($1::text IS NULL OR ${GROUP_STATUS_SQL} = $1)
        ORDER BY CASE ${GROUP_STATUS_SQL} WHEN 'new' THEN 0 WHEN 'triaged' THEN 1 WHEN 'fixed' THEN 2 ELSE 3 END,
                 max(last_seen) DESC
        LIMIT $3`,
      [opts.status ?? null, q, Math.min(Math.max(1, opts.limit ?? 100), 200)],
    );
    return rows.map((r) => ({
      ...r,
      total_count: Number(r.total_count),
      user_count: Number(r.user_count),
      reopen_count: Number(r.reopen_count),
    }));
  });
}

export type BugReportRow = {
  id: string;
  user_id: string;
  kind: string;
  status: BugStatus;
  title: string;
  message: string | null;
  stack: string | null;
  route: string | null;
  app_version: string | null;
  user_agent: string | null;
  description: string | null;
  context: Record<string, unknown>;
  count: number;
  reopen_count: number;
  first_seen: string;
  last_seen: string;
  reopened_at: string | null;
  fixed_at: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  admin_note: string | null;
  has_screenshot: boolean;
};

export async function getBugGroupReports(fingerprint: string, limit = 50): Promise<BugReportRow[]> {
  return run(async () => {
    const { rows } = await getPool().query<BugReportRow>(
      `SELECT id, user_id, kind, status, title, message, stack, route, app_version, user_agent,
              description, context, count, reopen_count, first_seen, last_seen, reopened_at,
              fixed_at, status_changed_at, status_changed_by, admin_note,
              (screenshot IS NOT NULL) AS has_screenshot
         FROM bug_reports WHERE fingerprint = $1
        ORDER BY last_seen DESC LIMIT $2`,
      [fingerprint, Math.min(Math.max(1, limit), 200)],
    );
    return rows.map((r) => ({ ...r, count: Number(r.count), reopen_count: Number(r.reopen_count) }));
  });
}

export async function getBugScreenshot(id: string): Promise<string | null> {
  return run(async () => {
    const { rows } = await getPool().query<{ screenshot: string | null }>(
      `SELECT screenshot FROM bug_reports WHERE id = $1`,
      [id],
    );
    return rows[0]?.screenshot ?? null;
  });
}

export async function setBugGroupStatus(
  fingerprint: string,
  status: BugStatus,
  opts: { note: string | null; actor: string },
): Promise<number> {
  return run(async () => {
    const { rows } = await getPool().query<{ n: number }>(
      `WITH upd AS (
         UPDATE bug_reports SET
           status = $2,
           admin_note = coalesce($3, admin_note),
           status_changed_at = now(),
           status_changed_by = $4,
           fixed_at = CASE WHEN $2 = 'fixed' THEN now() ELSE fixed_at END,
           updated_at = now()
          WHERE fingerprint = $1
        RETURNING 1)
       SELECT count(*)::int AS n FROM upd`,
      [fingerprint, status, opts.note, opts.actor],
    );
    return Number(rows[0]?.n ?? 0);
  });
}
