import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// NOTE:
// The api-server currently uses the shared DB package schema from `@workspace/db`
// for core chat persistence. This local schema.ts is only used for lightweight
// integration artifacts in this artifacts/* folder.
//
// Personality evolution MVP stores a per-character milestone counter and
// an opaque evolution_delta JSON blob that promptBuilder can inject.

export const characters = pgTable('characters', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const animaEvolution = pgTable(
  'anima_evolution',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    animaId: text('anima_id').notNull(),

    conversationCount: integer('conversation_count').notNull().default(0),
    voidSessions: integer('void_sessions').notNull().default(0),

    // Last generated evolution delta for the prompt builder.
    // Structure is intentionally versioned and opaque to avoid migrations
    // every time we tweak the prompt.
    evolutionDelta: jsonb('evolution_delta')
      .$type<{
        version: number
        appliedAt: string
        milestone: number
        traitsDelta: Record<string, unknown>
        quirkAdditions: string[]
        voidBias?: number
      }>()
      .notNull()
      .default({
        version: 1,
        appliedAt: new Date(0).toISOString(),
        milestone: 0,
        traitsDelta: {},
        quirkAdditions: [],
        voidBias: 0,
      }),

    // Store the textual rationale (for debugging/admin tools only).
    evolutionRationale: text('evolution_rationale').notNull().default(''),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    animaEvolutionUserAnimaUq: uniqueIndex(
      'anima_evolution_user_anima_uq',
    ).on(t.userId, t.animaId),
  }),
)

