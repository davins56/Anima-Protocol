/**
 * Tables created by supabase/migrations/*.sql (not by Drizzle). drizzle-kit
 * must never push/drop them, and scripts/ci/check-migration-safety.mjs refuses
 * destructive SQL against them. Append-only list — never remove an entry.
 */
export const PROTECTED_SQL_TABLES = [
  "character_visual_identity",
  "generated_images",
  "character_identity_core",
  "memory_events",
  "memory_event_types",
  "memory_recalls",
  "character_identity_current",
  "character_vessel",
  "resonance_bands",
  "resonance_nodes",
  "resonance_encounters",
  "character_voice",
  "sim_sessions",
  "sim_actions",
  "sim_arena_snapshots",
  "chat_resting_queue",
  "chat_resting_deliveries",
  "chat_resting_pending",
] as const;
