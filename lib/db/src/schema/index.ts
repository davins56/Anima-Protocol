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
    userEntityCreatedIdx: index("user_entities_created_idx").on(
      t.userId,
      t.entityName,
      sql`(case when jsonb_typeof(data -> 'created_date') = 'number' then (data ->> 'created_date')::numeric end) desc nulls last`,
      sql`((data ->> 'created_date') collate "C") desc nulls last`,
    ),
    userEntityUpdatedIdx: index("user_entities_updated_idx").on(
      t.userId,
      t.entityName,
      sql`(case when jsonb_typeof(data -> 'updated_date') = 'number' then (data ->> 'updated_date')::numeric end) desc nulls last`,
      sql`((data ->> 'updated_date') collate "C") desc nulls last`,
    ),
    // Filter indexes for the most common equality lookups (session_id scopes
    // world state / calendars / quests; character_id scopes journals /
    // inventory). jsonb sub-value matches the `data -> 'field' = ...` condition.
    userEntitySessionIdx: index("user_entities_session_idx").on(
      t.userId,
      t.entityName,
      sql`(data -> 'session_id')`,
    ),
    userEntityCharacterIdx: index("user_entities_character_idx").on(
      t.userId,
      t.entityName,
      sql`(data -> 'character_id')`,
    ),
    // Chat messages are stored as individual rows (entity_name 'ChatMessage')
    // keyed by session_id and ordered by a per-session integer `seq`. This
    // composite index lets the store read one session's messages in seq order
    // (with a LIMIT for paging) without a sort step, and keeps appends cheap as
    // a conversation's history grows.
    userEntitySessionSeqIdx: index("user_entities_session_seq_idx").on(
      t.userId,
      t.entityName,
      sql`(data -> 'session_id')`,
      sql`((data ->> 'seq')::numeric)`,
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
