import type pg from "pg";
import { getPool } from "./client";

/** Core relations the store / chat API require. */
export const REQUIRED_TABLES = [
  "user_entities",
  "user_profiles",
  "push_subscriptions",
  "proactive_message_preferences",
  "conversations",
  "messages",
  "chat_sessions",
  "chat_messages",
  "companion_memories",
  "memory_embeddings",
  "uploaded_images",
  // Companion state used on every /api/chat/messages turn. Missing these
  // previously 500'd the whole reply before the LLM was even called.
  "anima_evolution",
  "anima_relationships",
  "anima_narrative_arcs",
] as const;

export type RequiredTable = (typeof REQUIRED_TABLES)[number];

export type SchemaInspection = {
  ok: boolean;
  missingTables: RequiredTable[];
  presentTables: RequiredTable[];
  hasPgTrgm: boolean;
};

export type EnsureSchemaResult = {
  ok: boolean;
  missingBefore: RequiredTable[];
  createdTables: RequiredTable[];
  hasPgTrgm: boolean;
  errors: string[];
};

type Queryable = Pick<pg.Pool, "query">;

async function listPresentTables(
  db: Queryable,
  names: readonly string[],
): Promise<Set<string>> {
  // Use current_schema() so disposable test search_paths and production
  // `public` both work. Extensions still live in the global catalog.
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_type = 'BASE TABLE'
       AND table_name = ANY($1::text[])`,
    [names],
  );
  return new Set(rows.map((r) => r.table_name));
}

async function hasPgTrgmExtension(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
     ) AS exists`,
  );
  return Boolean(rows[0]?.exists);
}

/** Inspect whether the production schema matches what the API expects. */
export async function inspectSchema(
  db: Queryable = getPool(),
): Promise<SchemaInspection> {
  const present = await listPresentTables(db, REQUIRED_TABLES);
  const presentTables = REQUIRED_TABLES.filter((t) => present.has(t));
  const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));
  const hasPgTrgm = await hasPgTrgmExtension(db);
  return {
    ok: missingTables.length === 0,
    missingTables,
    presentTables,
    hasPgTrgm,
  };
}

/**
 * Idempotent DDL that brings a blank (or partially migrated) Postgres up to
 * the relations expected by `@workspace/db`. Safe to re-run: uses
 * IF NOT EXISTS / exception guards throughout.
 *
 * This is the serverless-friendly alternative to `drizzle-kit push` for
 * production recovery when the UI reports "Database schema is missing or out
 * of date".
 */
export async function ensureSchema(
  db: Queryable = getPool(),
): Promise<EnsureSchemaResult> {
  const before = await inspectSchema(db);
  const errors: string[] = [];
  const createdTables: RequiredTable[] = [];

  const run = async (sql: string, label: string): Promise<void> => {
    try {
      await db.query(sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${label}: ${message.slice(0, 240)}`);
    }
  };

  await run(
    `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
    "extension:pg_trgm",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "conversations" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL DEFAULT '',
      "title" text DEFAULT 'New conversation' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:conversations",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "messages" (
      "id" serial PRIMARY KEY NOT NULL,
      "conversation_id" integer NOT NULL,
      "role" text NOT NULL,
      "content" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:messages",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "user_entities" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "entity_name" text NOT NULL,
      "entity_id" text NOT NULL,
      "data" jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:user_entities",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "user_profiles" (
      "user_id" text PRIMARY KEY NOT NULL,
      "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:user_profiles",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "push_subscriptions" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "endpoint" text NOT NULL,
      "p256dh" text NOT NULL,
      "auth" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:push_subscriptions",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "proactive_message_preferences" (
      "user_id" text PRIMARY KEY NOT NULL,
      "enabled" boolean DEFAULT false NOT NULL,
      "frequency_hours" integer DEFAULT 24 NOT NULL,
      "last_sent_at" timestamp,
      "next_message_at" timestamp,
      "last_session_id" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:proactive_message_preferences",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "uploaded_images" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "content_type" text NOT NULL,
      "data_base64" text NOT NULL,
      "byte_size" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:uploaded_images",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "uploaded_images_user_idx"
       ON "uploaded_images" USING btree ("user_id")`,
    "index:uploaded_images_user_idx",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "chat_sessions" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "title" text DEFAULT 'New session' NOT NULL,
      "mode" text DEFAULT 'solo' NOT NULL,
      "character_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "is_crossover" boolean DEFAULT false NOT NULL,
      "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:chat_sessions",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "chat_messages" (
      "id" text PRIMARY KEY NOT NULL,
      "session_id" text NOT NULL,
      "user_id" text NOT NULL,
      "role" text NOT NULL,
      "content" text NOT NULL,
      "character_id" text,
      "character_name" text,
      "is_crossover" boolean DEFAULT false NOT NULL,
      "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:chat_messages",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "companion_memories" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "character_id" text NOT NULL,
      "summary" text DEFAULT '' NOT NULL,
      "facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "emotional_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "resonance_notes" text DEFAULT '' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:companion_memories",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "memory_embeddings" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "character_id" text NOT NULL,
      "fact_id" text NOT NULL,
      "text" text NOT NULL,
      "memory_type" text DEFAULT 'unknown' NOT NULL,
      "embedding" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "model" text DEFAULT 'hash-bow-v1' NOT NULL,
      "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    "table:memory_embeddings",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "anima_evolution" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "anima_id" text NOT NULL,
      "conversation_count" integer DEFAULT 0 NOT NULL,
      "void_sessions" integer DEFAULT 0 NOT NULL,
      "evolution_delta" jsonb DEFAULT '{"version":1,"appliedAt":"1970-01-01T00:00:00.000Z","milestone":0,"traitsDelta":{},"quirkAdditions":[],"voidBias":0}'::jsonb NOT NULL,
      "evolution_rationale" text DEFAULT '' NOT NULL,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`,
    "table:anima_evolution",
  );
  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS "anima_evolution_user_anima_uq"
       ON "anima_evolution" USING btree ("user_id","anima_id")`,
    "index:anima_evolution_user_anima_uq",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "anima_relationships" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "anima_id" text NOT NULL,
      "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`,
    "table:anima_relationships",
  );
  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS "anima_relationships_user_anima_uq"
       ON "anima_relationships" USING btree ("user_id","anima_id")`,
    "index:anima_relationships_user_anima_uq",
  );

  await run(
    `CREATE TABLE IF NOT EXISTS "anima_narrative_arcs" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "anima_id" text NOT NULL,
      "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp DEFAULT now(),
      "updated_at" timestamp DEFAULT now()
    )`,
    "table:anima_narrative_arcs",
  );
  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS "anima_narrative_arcs_user_anima_uq"
       ON "anima_narrative_arcs" USING btree ("user_id","anima_id")`,
    "index:anima_narrative_arcs_user_anima_uq",
  );

  // Column default added after initial conversations table existed in prod.
  await run(
    `ALTER TABLE "conversations" ALTER COLUMN "user_id" SET DEFAULT ''`,
    "alter:conversations.user_id_default",
  );

  await run(
    `DO $$ BEGIN
       ALTER TABLE "messages"
         ADD CONSTRAINT "messages_conversation_id_conversations_id_fk"
         FOREIGN KEY ("conversation_id")
         REFERENCES "conversations"("id")
         ON DELETE no action ON UPDATE no action;
     EXCEPTION
       WHEN duplicate_object THEN NULL;
       WHEN undefined_table THEN NULL;
     END $$`,
    "fk:messages_conversation_id",
  );

  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS "user_entities_user_entity_id_uq"
       ON "user_entities" USING btree ("user_id","entity_name","entity_id")`,
    "index:user_entities_user_entity_id_uq",
  );
  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_uq"
       ON "push_subscriptions" USING btree ("endpoint")`,
    "index:push_subscriptions_endpoint_uq",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
       ON "push_subscriptions" USING btree ("user_id")`,
    "index:push_subscriptions_user_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "proactive_message_preferences_due_idx"
       ON "proactive_message_preferences" USING btree ("enabled","next_message_at")`,
    "index:proactive_message_preferences_due_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "user_entities_user_entity_idx"
       ON "user_entities" USING btree ("user_id","entity_name")`,
    "index:user_entities_user_entity_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "user_entities_created_idx"
       ON "user_entities" USING btree (
         "user_id",
         "entity_name",
         (case when (data ->> 'created_date') ~ '^-?[0-9]+([.][0-9]+)?$'
           then (data ->> 'created_date')::numeric end) desc nulls last,
         ((data ->> 'created_date') collate "C") desc nulls last
       )`,
    "index:user_entities_created_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "user_entities_updated_idx"
       ON "user_entities" USING btree (
         "user_id",
         "entity_name",
         (case when (data ->> 'updated_date') ~ '^-?[0-9]+([.][0-9]+)?$'
           then (data ->> 'updated_date')::numeric end) desc nulls last,
         ((data ->> 'updated_date') collate "C") desc nulls last
       )`,
    "index:user_entities_updated_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "user_entities_session_seq_idx"
       ON "user_entities" USING btree (
         "user_id",
         "entity_name",
         (data ->> 'session_id'),
         ((data ->> 'seq')::numeric)
       )`,
    "index:user_entities_session_seq_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "user_entities_title_trgm_idx"
       ON "user_entities" USING gin ((data ->> 'title') gin_trgm_ops)`,
    "index:user_entities_title_trgm_idx",
  );

  await run(
    `CREATE INDEX IF NOT EXISTS "chat_messages_session_idx"
       ON "chat_messages" USING btree ("user_id","session_id","created_at")`,
    "index:chat_messages_session_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "chat_messages_character_idx"
       ON "chat_messages" USING btree ("user_id","character_id")`,
    "index:chat_messages_character_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "chat_sessions_user_idx"
       ON "chat_sessions" USING btree ("user_id")`,
    "index:chat_sessions_user_idx",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "chat_sessions_updated_idx"
       ON "chat_sessions" USING btree ("user_id","updated_at")`,
    "index:chat_sessions_updated_idx",
  );
  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS "companion_memories_user_character_uq"
       ON "companion_memories" USING btree ("user_id","character_id")`,
    "index:companion_memories_user_character_uq",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "companion_memories_user_idx"
       ON "companion_memories" USING btree ("user_id")`,
    "index:companion_memories_user_idx",
  );

  await run(
    `CREATE UNIQUE INDEX IF NOT EXISTS "memory_embeddings_user_char_fact_uq"
       ON "memory_embeddings" USING btree ("user_id","character_id","fact_id")`,
    "index:memory_embeddings_user_char_fact_uq",
  );
  await run(
    `CREATE INDEX IF NOT EXISTS "memory_embeddings_user_char_idx"
       ON "memory_embeddings" USING btree ("user_id","character_id")`,
    "index:memory_embeddings_user_char_idx",
  );

  const after = await inspectSchema(db);
  for (const table of after.presentTables) {
    if (before.missingTables.includes(table)) {
      createdTables.push(table);
    }
  }

  return {
    ok: after.ok,
    missingBefore: before.missingTables,
    createdTables,
    hasPgTrgm: after.hasPgTrgm,
    errors,
  };
}

let ensureOnce: Promise<EnsureSchemaResult> | null = null;

/**
 * Ensure schema at most once per process. Concurrent callers share the same
 * promise. Failures clear the latch so a later request can retry (e.g. after
 * a transient privilege error creating an extension).
 */
export function ensureSchemaOnce(
  db: Queryable = getPool(),
): Promise<EnsureSchemaResult> {
  if (!ensureOnce) {
    ensureOnce = ensureSchema(db).then(
      (result) => {
        if (!result.ok) {
          // Keep retrying until core tables exist.
          ensureOnce = null;
        }
        return result;
      },
      (err) => {
        ensureOnce = null;
        throw err;
      },
    );
  }
  return ensureOnce;
}

/** Test helper — clears the once-latch between cases. */
export function resetEnsureSchemaLatch(): void {
  ensureOnce = null;
}
