import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
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
