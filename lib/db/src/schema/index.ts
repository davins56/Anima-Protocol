import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  customType,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  // Server-side default so the publish-time migration can add this NOT NULL
  // column to pre-existing production rows (legacy test conversations) without
  // failing. App code always inserts an explicit userId, so the default is only
  // ever applied to those legacy rows, never in normal operation.
  userId: text("user_id").notNull().default(""),
  title: text("title").notNull().default("New conversation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// Product chat backend tables. These mirror the high-level ChatSession /
// ChatMessage entity-store model with a structured schema the API can use for
// memory-aware generation, analytics, and future vector indexing. The generic
// user_entities rows remain the compatibility surface for the existing client.
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New session"),
    mode: text("mode").notNull().default("solo"),
    characterIds: jsonb("character_ids").$type<string[]>().notNull().default([]),
    isCrossover: boolean("is_crossover").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    chatSessionsUserIdx: index("chat_sessions_user_idx").on(t.userId),
    chatSessionsUpdatedIdx: index("chat_sessions_updated_idx").on(
      t.userId,
      t.updatedAt,
    ),
  }),
);

export type ChatSession = typeof chatSessions.$inferSelect;

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    characterId: text("character_id"),
    characterName: text("character_name"),
    isCrossover: boolean("is_crossover").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    chatMessagesSessionIdx: index("chat_messages_session_idx").on(
      t.userId,
      t.sessionId,
      t.createdAt,
    ),
    chatMessagesCharacterIdx: index("chat_messages_character_idx").on(
      t.userId,
      t.characterId,
    ),
  }),
);

export type ChatMessage = typeof chatMessages.$inferSelect;

/**
 * Durable chat-turn ledger. A generated reply is checkpointed here before the
 * SSE `done` event, then idempotent message persistence advances it to
 * `committed`. Failed/client-interrupted writes remain retryable.
 *
 * `lease_expires_at` is the running-owner lease. A pending turn whose lease
 * has expired can be claimed by another isolate. `waiting_until` is set by a
 * retry that is joined to that owner so a disconnect does not abort the slot
 * while someone is still waiting.
 */
export const chatTurns = pgTable(
  "chat_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    assistantMessageId: text("assistant_message_id").notNull(),
    persistenceOwner: text("persistence_owner").notNull().default("server"),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    userContent: text("user_content").notNull().default(""),
    assistantContent: text("assistant_content").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    waitingUntil: timestamp("waiting_until"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    committedAt: timestamp("committed_at"),
  },
  (t) => ({
    chatTurnsSessionIdx: index("chat_turns_session_idx").on(
      t.userId,
      t.sessionId,
      t.createdAt,
    ),
    chatTurnsRetryIdx: index("chat_turns_retry_idx").on(
      t.userId,
      t.status,
      t.updatedAt,
    ),
  }),
);

export type ChatTurn = typeof chatTurns.$inferSelect;

/**
 * Background local-model work that must not be dropped while someone is
 * chatting (milestone evolution, distilled memories). The proactive cron
 * drains rows once `chat_turns` shows the quiet window is clear.
 */
export const localLlmDeferredJobs = pgTable(
  "local_llm_deferred_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    localLlmDeferredKindIdx: index("local_llm_deferred_jobs_kind_idx").on(
      t.kind,
      t.createdAt,
    ),
  }),
);

export type LocalLlmDeferredJob = typeof localLlmDeferredJobs.$inferSelect;

export const companionMemories = pgTable(
  "companion_memories",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    summary: text("summary").notNull().default(""),
    facts: jsonb("facts").$type<Record<string, unknown>[]>().notNull().default([]),
    emotionalState: jsonb("emotional_state").$type<Record<string, unknown>>().notNull().default({}),
    resonanceNotes: text("resonance_notes").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companionMemoriesUserCharacterUq: uniqueIndex(
      "companion_memories_user_character_uq",
    ).on(t.userId, t.characterId),
    companionMemoriesUserIdx: index("companion_memories_user_idx").on(
      t.userId,
    ),
  }),
);

export type CompanionMemory = typeof companionMemories.$inferSelect;

/**
 * Per-fact embedding rows for semantic memory retrieval.
 * Vectors are stored as JSON number[] so the stack works without pgvector.
 * Optional later upgrade: migrate `embedding` to a pgvector column.
 */
export const memoryEmbeddings = pgTable(
  "memory_embeddings",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    /** Stable id for the fact within companion_memories.facts (or a hash of text). */
    factId: text("fact_id").notNull(),
    text: text("text").notNull(),
    memoryType: text("memory_type").notNull().default("unknown"),
    embedding: jsonb("embedding").$type<number[]>().notNull().default([]),
    model: text("model").notNull().default("hash-bow-v1"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    memoryEmbeddingsFactUq: uniqueIndex("memory_embeddings_user_char_fact_uq").on(
      t.userId,
      t.characterId,
      t.factId,
    ),
    memoryEmbeddingsUserCharIdx: index("memory_embeddings_user_char_idx").on(
      t.userId,
      t.characterId,
    ),
  }),
);

export type MemoryEmbedding = typeof memoryEmbeddings.$inferSelect;

// Generic per-user entity store. One row per (user, entity name, entity id),
// holding the whole record as JSON. Backs the client's base44 entity CRUD so
// that all user progress (characters, chats, journals, inventory, quests, world
// state, settings, etc.) persists on the server scoped to the Clerk account.
export const userEntities = pgTable(
  "user_entities",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    entityName: text("entity_name").notNull(),
    entityId: text("entity_id").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userEntityIdUq: uniqueIndex("user_entities_user_entity_id_uq").on(
      t.userId,
      t.entityName,
      t.entityId,
    ),
    userEntityIdx: index("user_entities_user_entity_idx").on(
      t.userId,
      t.entityName,
    ),
    // Expression indexes that let the store's list endpoint push filtering and
    // sorting into SQL at scale. Each is prefixed by (user_id, entity_name) so
    // it stays scoped to a single entity partition, then keyed by a commonly
    // filtered/sorted JSONB field. The field names are inlined as literals by
    // the query builder so the planner can match these indexes.
    //
    // Sort indexes mirror GET /:entity's ORDER BY for "-created_date" /
    // "-updated_date" (the dominant sorts) exactly — same numeric/text split,
    // collation, direction and NULLS ordering — so they satisfy ORDER BY +
    // LIMIT without a sort step.
    // Numeric detection uses a regex on the TEXT projection (data ->> 'field'),
    // NOT jsonb_typeof(data -> 'field'). A bare jsonb `->` anywhere in an
    // expression index — even nested inside jsonb_typeof()/a CASE — makes the
    // publish-time schema-diff DDL generator misplace operator-class tokens
    // (e.g. `... = text_ops, ...`) inside the CASE, producing invalid SQL that
    // Postgres rejects and which blocks the production migration. The regex
    // `^-?[0-9]+([.][0-9]+)?$` matches exactly the canonical decimal text that a
    // JSON number serializes to via `->>` (jsonb numerics never emit exponents),
    // so the `::numeric` cast is always safe. This MUST stay byte-for-byte
    // identical to store.ts orderByParts or the planner stops using the index.
    userEntityCreatedIdx: index("user_entities_created_idx").on(
      t.userId,
      t.entityName,
      sql`(case when (data ->> 'created_date') ~ '^-?[0-9]+([.][0-9]+)?$' then (data ->> 'created_date')::numeric end) desc nulls last`,
      sql`((data ->> 'created_date') collate "C") desc nulls last`,
    ),
    userEntityUpdatedIdx: index("user_entities_updated_idx").on(
      t.userId,
      t.entityName,
      sql`(case when (data ->> 'updated_date') ~ '^-?[0-9]+([.][0-9]+)?$' then (data ->> 'updated_date')::numeric end) desc nulls last`,
      sql`((data ->> 'updated_date') collate "C") desc nulls last`,
    ),
    // Chat messages are stored as individual rows (entity_name 'ChatMessage')
    // keyed by session_id and ordered by a per-session integer `seq`. This
    // composite index lets the store read one session's messages in seq order
    // (with a LIMIT for paging) without a sort step, and keeps appends cheap as
    // a conversation's history grows.
    //
    // session_id is projected as TEXT (->>) here, not jsonb (->), for two
    // reasons: it matches the message-read queries' text scoping (see
    // sessionIdEq), and it keeps every column of this index on a btree
    // text/numeric operator class. A jsonb (->) expression column makes the
    // publish-time schema-diff emit a jsonb operator class onto the adjacent
    // TEXT column (entity_name) — `... entity_name jsonb_ops ...` — which
    // Postgres rejects with "operator class jsonb_ops does not accept data type
    // text" and which blocks the production migration. Pure-equality jsonb
    // filter lookups (session_id / character_id) fall back to the
    // (user_id, entity_name) index above; at this store's scale a single user's
    // per-entity partition is tiny, so the dedicated jsonb indexes are not worth
    // re-introducing the migration hazard.
    userEntitySessionSeqIdx: index("user_entities_session_seq_idx").on(
      t.userId,
      t.entityName,
      sql`(data ->> 'session_id')`,
      sql`((data ->> 'seq')::numeric)`,
    ),
    // GIN trigram index backing the store's case-insensitive substring search on
    // the JSONB `title` field (see store.ts searchCondition: `(data ->> 'title')
    // ilike '%term%'`). Without it an ILIKE '%...%' must scan the whole partition,
    // which gets slow once an account amasses a large library; pg_trgm lets the
    // planner satisfy the ILIKE from the index and bitmap-AND it with the
    // (user_id, entity_name) index above.
    //
    // The expression is the TEXT projection `data ->> 'title'`, NOT the jsonb
    // `data -> 'title'`: a jsonb (->) expression column makes the publish-time
    // schema-diff emit a jsonb operator class onto an adjacent text column, which
    // Postgres rejects and which blocks the production migration. `->>` keeps the
    // indexed expression text-typed so gin_trgm_ops applies cleanly.
    //
    // Requires the pg_trgm extension (created idempotently in scripts/post-merge.sh
    // before `drizzle-kit push`, since push does not manage extensions).
    userEntityTitleTrgmIdx: index("user_entities_title_trgm_idx").using(
      "gin",
      sql`(data ->> 'title') gin_trgm_ops`,
    ),
  }),
);

export type UserEntity = typeof userEntities.$inferSelect;

// Per-user profile/settings record (the data previously kept in the browser's
// `anima_auth_user`). One row per Clerk user id.
export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type UserProfile = typeof userProfiles.$inferSelect;

// Browser Web Push destinations. An endpoint is unique to a browser profile;
// re-subscribing after an account switch intentionally transfers it to the
// currently authenticated Clerk user so signed-out accounts cannot keep
// notifying that device.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pushSubscriptionsEndpointUq: uniqueIndex(
      "push_subscriptions_endpoint_uq",
    ).on(t.endpoint),
    pushSubscriptionsUserIdx: index("push_subscriptions_user_idx").on(t.userId),
  }),
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// Opt-in and delivery cadence are server-owned so a cron invocation can claim
// due users atomically and never send duplicate proactive messages.
export const proactiveMessagePreferences = pgTable(
  "proactive_message_preferences",
  {
    userId: text("user_id").primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    frequencyHours: integer("frequency_hours").notNull().default(24),
    lastSentAt: timestamp("last_sent_at"),
    nextMessageAt: timestamp("next_message_at"),
    lastSessionId: text("last_session_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    proactiveMessagePreferencesDueIdx: index(
      "proactive_message_preferences_due_idx",
    ).on(t.enabled, t.nextMessageAt),
  }),
);

export type ProactiveMessagePreference =
  typeof proactiveMessagePreferences.$inferSelect;

/**
 * Portable avatar / image uploads for Vercel (no Replit object-storage sidecar).
 * Served at GET /api/storage/objects/uploads/:id
 */
export const uploadedImages = pgTable(
  "uploaded_images",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    contentType: text("content_type").notNull(),
    // Raw base64 payload (no data: URL prefix).
    dataBase64: text("data_base64").notNull(),
    byteSize: integer("byte_size").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("uploaded_images_user_idx").on(table.userId),
  }),
);

export type UploadedImage = typeof uploadedImages.$inferSelect;

/** Postgres full-text column. Populated in SQL with to_tsvector — not by Drizzle. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * PDF text the user shared in a chat or attached to a companion's lore.
 * The original file bytes are not stored. `pdf_chunks.search_vector` is
 * filled at insert time for Postgres full-text retrieval.
 */
export const pdfDocuments = pgTable(
  "pdf_documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** "chat" (this conversation) or "lore" (every chat with the companion). */
    scope: text("scope").notNull(),
    sessionId: text("session_id"),
    characterId: text("character_id"),
    filename: text("filename").notNull(),
    byteSize: integer("byte_size").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pdfDocumentsUserSessionIdx: index("pdf_documents_user_session_idx").on(
      t.userId,
      t.scope,
      t.sessionId,
    ),
    pdfDocumentsUserCharacterIdx: index("pdf_documents_user_character_idx").on(
      t.userId,
      t.scope,
      t.characterId,
    ),
  }),
);

export type PdfDocument = typeof pdfDocuments.$inferSelect;

export const pdfChunks = pgTable(
  "pdf_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    userId: text("user_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    pageStart: integer("page_start").notNull().default(1),
    pageEnd: integer("page_end").notNull().default(1),
    content: text("content").notNull(),
    searchVector: tsvector("search_vector").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pdfChunksDocumentIdx: index("pdf_chunks_document_idx").on(
      t.userId,
      t.documentId,
      t.chunkIndex,
    ),
    pdfChunksSearchIdx: index("pdf_chunks_search_idx").using(
      "gin",
      sql`search_vector`,
    ),
  }),
);

export type PdfChunk = typeof pdfChunks.$inferSelect;

/** Raw bytes. Reads and writes go through SQL (encode/decode), not Drizzle. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Own-model weights: one 512 KiB chunk per row. Must match BLOBS_DDL in
 * artifacts/api-server/src/lib/ownModel.ts and server/trainer.py.
 */
export const ownModelBlobs = pgTable(
  "own_model_blobs",
  {
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    idx: integer("idx").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    ownModelBlobsPk: primaryKey({
      name: "own_model_blobs_pk",
      columns: [t.version, t.kind, t.idx],
    }),
  }),
);

export type OwnModelBlob = typeof ownModelBlobs.$inferSelect;
