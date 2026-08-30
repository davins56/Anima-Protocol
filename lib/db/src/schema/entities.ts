
import { pgTable, text, serial, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const entityRecords = pgTable("entity_records", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().default("default_user"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull().unique(),
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("entity_records_user_type_idx").on(table.userId, table.entityType),
]);

export type EntityRecord = typeof entityRecords.$inferSelect;
export type InsertEntityRecord = typeof entityRecords.$inferInsert;
