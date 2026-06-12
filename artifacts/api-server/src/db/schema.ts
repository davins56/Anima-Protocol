import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const characters = pgTable('characters', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type'),
  // add any other columns you need
  createdAt: timestamp('created_at').defaultNow(),
})