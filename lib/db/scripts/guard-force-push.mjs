#!/usr/bin/env node
/**
 * `drizzle-kit push --force` auto-accepts data-loss statements. Allow it only
 * against a local / CI database unless ALLOW_FORCE_PUSH=1 is set explicitly.
 */
const url = process.env.DATABASE_URL || "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  host = "";
}
const local = ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(host);
if (!local && process.env.ALLOW_FORCE_PUSH !== "1") {
  console.error(
    `Refusing drizzle-kit push --force against "${host || "unknown host"}". ` +
      "It can drop companion memory. Use `pnpm --filter @workspace/db run push` (interactive), " +
      "or set ALLOW_FORCE_PUSH=1 if you have a backup and know what you are doing.",
  );
  process.exit(1);
}
