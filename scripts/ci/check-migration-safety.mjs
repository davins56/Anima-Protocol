#!/usr/bin/env node
/**
 * Fails CI when a migration (or deploy script) could destroy companion memory.
 *
 * - supabase/migrations/*.sql and lib/db/drizzle/*.sql must not DROP TABLE,
 *   TRUNCATE, DELETE FROM, DROP SCHEMA, ALTER TABLE ... DROP COLUMN, or
 *   DISABLE TRIGGER on a protected table (lib/db/protected-tables.ts).
 * - Migrations are append-only: an existing supabase migration file may not be
 *   modified or deleted relative to the base ref (MIGRATION_BASE_REF, default origin/main).
 * - package.json scripts, .github/workflows, scripts/**, deploy/** must not run
 *   `supabase db reset`, `drizzle-kit drop`, or `push --force` / `push-force`
 *   against a non-local database.
 *
 * Usage: node scripts/ci/check-migration-safety.mjs   (exit 1 on violation)
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

const root = new URL("../..", import.meta.url).pathname;
const problems = [];

const protectedSrc = readFileSync(join(root, "lib/db/protected-tables.ts"), "utf8");
const PROTECTED = [...protectedSrc.matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]);
// Legacy companion memory tables managed by Drizzle are protected from raw SQL too.
PROTECTED.push("companion_memories", "memory_embeddings", "resonance_memories", "user_entities", "chat_messages");

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function tableRe(t) {
  return `(?:"?public"?\\.)?"?${t}"?\\b`;
}

function checkSql(file) {
  const sql = stripSqlComments(readFileSync(file, "utf8"));
  const rel = relative(root, file);
  for (const t of PROTECTED) {
    const T = tableRe(t);
    const rules = [
      [new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?[^;]*${T}`, "i"), "DROP TABLE"],
      [new RegExp(`(?<!(?:BEFORE|OR|,)\\s*)\\bTRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?(?!ON\\b)[^;]*${T}`, "i"), "TRUNCATE"],
      [new RegExp(`\\bDELETE\\s+FROM\\s+${T}`, "i"), "DELETE FROM"],
      [new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${T}[^;]*DROP\\s+(?:COLUMN|CONSTRAINT)`, "i"), "ALTER TABLE ... DROP"],
      [new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${T}[^;]*DISABLE\\s+(?:TRIGGER|ROW\\s+LEVEL)`, "i"), "DISABLE TRIGGER/RLS"],
      [new RegExp(`DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?[a-z0-9_]*(?:immutable|no_update|no_truncate)[a-z0-9_]*\\s+ON\\s+${T}[^;]*;(?![\\s\\S]{0,400}CREATE\\s+TRIGGER)`, "i"), "DROP immutability trigger without re-create"],
    ];
    for (const [re, label] of rules) if (re.test(sql)) problems.push(`${rel}: ${label} on protected table "${t}"`);
  }
  if (/DROP\s+SCHEMA\s+(?:IF\s+EXISTS\s+)?"?public"?/i.test(sql)) problems.push(`${rel}: DROP SCHEMA public`);
}

function listSql(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith(".sql")).map((f) => join(abs, f));
}

for (const f of [...listSql("supabase/migrations"), ...listSql("lib/db/drizzle")]) checkSql(f);

// Append-only migrations vs base ref (skipped when git/base is unavailable).
const baseRef = process.env.MIGRATION_BASE_REF || "origin/main";
try {
  execSync(`git rev-parse --verify ${baseRef}`, { cwd: root, stdio: "ignore" });
  const diff = execSync(`git diff --name-status ${baseRef} -- supabase/migrations`, { cwd: root, encoding: "utf8" });
  for (const line of diff.split("\n").filter(Boolean)) {
    const [status, path] = line.split(/\s+/);
    if (status !== "A") problems.push(`${path}: existing migration ${status === "D" ? "deleted" : "modified"} (migrations are append-only)`);
  }
} catch {
  // No base ref (fresh clone / local) — content checks above still apply.
}

// Destructive commands in scripts / workflows.
const DANGEROUS = [
  [/supabase\s+db\s+reset/i, "supabase db reset"],
  [/drizzle-kit\s+drop/i, "drizzle-kit drop"],
  [/supabase\s+db\s+push[^\n]*--include-all[^\n]*--reset/i, "supabase db push --reset"],
];
function walk(dir, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name.startsWith(".git") && name !== ".github") continue;
    const p = join(abs, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(relative(root, p), out);
    else if (/\.(ya?ml|sh|mjs|js|ts|json|toml)$/.test(name)) out.push(p);
  }
  return out;
}
const scanFiles = [
  join(root, "package.json"),
  join(root, "lib/db/package.json"),
  ...walk(".github/workflows"),
  ...walk("scripts"),
  ...walk("deploy"),
].filter((f) => existsSync(f) && !f.endsWith("check-migration-safety.mjs"));
for (const f of scanFiles) {
  const text = readFileSync(f, "utf8");
  for (const [re, label] of DANGEROUS) if (re.test(text)) problems.push(`${relative(root, f)}: runs "${label}"`);
  // push-force is only allowed through the guarded lib/db script.
  if (/push-force|drizzle-kit\s+push\s+[^\n]*--force/.test(text) && !f.endsWith("lib/db/package.json")) {
    problems.push(`${relative(root, f)}: uses drizzle push --force`);
  }
}
const dbPkg = JSON.parse(readFileSync(join(root, "lib/db/package.json"), "utf8"));
if (dbPkg.scripts?.["push-force"] && !/guard-force-push/.test(dbPkg.scripts["push-force"])) {
  problems.push(`lib/db/package.json: push-force must run scripts/guard-force-push.mjs first`);
}
if (!/tablesFilter/.test(readFileSync(join(root, "lib/db/drizzle.config.ts"), "utf8"))) {
  problems.push("lib/db/drizzle.config.ts: tablesFilter for protected SQL tables is missing");
}

if (problems.length) {
  console.error("Migration safety check FAILED:\n" + problems.map((p) => `  ✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Migration safety check passed (${PROTECTED.length} protected tables).`);
