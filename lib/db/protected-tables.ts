/**
 * Tables created by supabase/migrations/*.sql (not by Drizzle). drizzle-kit
 * must never push/drop them, and scripts/ci/check-migration-safety.mjs refuses
 * destructive SQL against them. Append-only list — never remove an entry.
 */
export const PROTECTED_SQL_TABLES = [
  "character_visual_identity",
  "generated_images",
] as const;
