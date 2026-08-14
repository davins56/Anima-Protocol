import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  serial,
  boolean,
} from "drizzle-orm/pg-core";

// NOTE:
// The api-server currently uses the shared DB package schema from `@workspace/db`
// for core chat persistence. This local schema.ts is only used for lightweight
// integration artifacts in this artifacts/* folder.
//
// Personality evolution MVP stores a per-character milestone counter and
// an opaque evolution_delta JSON blob that promptBuilder can inject.

export const characters = pgTable("characters", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const animaEvolution = pgTable(
  "anima_evolution",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    animaId: text("anima_id").notNull(),

    conversationCount: integer("conversation_count")
      .notNull()
      .default(0),
    voidSessions: integer("void_sessions").notNull().default(0),

    // Last generated evolution delta for the prompt builder.
    // Structure is intentionally versioned and opaque to avoid migrations
    // every time we tweak the prompt.
    evolutionDelta: jsonb("evolution_delta")
      .$type<{
        version: number;
        appliedAt: string;
        milestone: number;
        traitsDelta: Record<string, unknown>;
        quirkAdditions: string[];
        voidBias?: number;
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
    evolutionRationale: text("evolution_rationale")
      .notNull()
      .default(""),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    animaEvolutionUserAnimaUq: uniqueIndex(
      "anima_evolution_user_anima_uq",
    ).on(t.userId, t.animaId),
  }),
);

// ------------------------------
// Relationship dynamics (A)
// ------------------------------

export const animaRelationships = pgTable(
  "anima_relationships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    animaId: text("anima_id").notNull(),

    // We keep this as JSONB to avoid rapid migrations while iterating on the
    // relationship engine.
    state: jsonb("state")
      .$type<any>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    animaRelationshipsUserAnimaUq: uniqueIndex(
      "anima_relationships_user_anima_uq",
    ).on(t.userId, t.animaId),
  }),
);

// ------------------------------
// Narrative arcs (B)
// ------------------------------

export const animaNarrativeArcs = pgTable(
  "anima_narrative_arcs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    animaId: text("anima_id").notNull(),

    state: jsonb("state")
      .$type<any>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    animaNarrativeArcsUserAnimaUq: uniqueIndex(
      "anima_narrative_arcs_user_anima_uq",
    ).on(t.userId, t.animaId),
  }),
);

// ============================================================
// RELATIONSHIP OS — Timeline / Resonance Memories / Journal / Home
// ============================================================

/**
 * Relationship Timeline Events
 * Chronological ledger of meaningful relationship moments.
 * Powers the Relationship Timeline UI, chapters, and Memory Palace.
 */
export const relationshipTimelineEvents = pgTable(
  "relationship_timeline_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    animaId: text("anima_id").notNull(),
    sessionId: text("session_id"),

    /** event | milestone | chapter | emotional_shift | ritual | first | breakthrough */
    eventType: text("event_type").notNull().default("event"),
    title: text("title").notNull().default(""),
    summary: text("summary").notNull().default(""),

    /** Optional structured payload (delta, resonance snapshot, chapter metadata) */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),

    /** Importance weight for prioritization / Memory Palace ranking (0-100) */
    significance: integer("significance").notNull().default(50),

    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    timelineUserAnimaIdx: index("rel_timeline_user_anima_idx").on(
      t.userId,
      t.animaId,
      t.occurredAt,
    ),
    timelineTypeIdx: index("rel_timeline_type_idx").on(
      t.userId,
      t.animaId,
      t.eventType,
    ),
  }),
);

/**
 * Resonance Memories
 * Crystallized high-resonance moments. Each carries a vector snapshot
 * so the system can re-activate the emotional/physical state when recalled.
 */
export const resonanceMemories = pgTable(
  "resonance_memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    animaId: text("anima_id").notNull(),
    sessionId: text("session_id"),

    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),

    /** Full ResonanceVector at the moment of crystallization */
    resonanceSnapshot: jsonb("resonance_snapshot")
      .$type<{
        intimacy: number;
        powerDynamic: number;
        spiritualAttunement: number;
        primalIntensity: number;
        crossoverOpenness: number;
      }>()
      .notNull()
      .default({
        intimacy: 30,
        powerDynamic: 0,
        spiritualAttunement: 20,
        primalIntensity: 15,
        crossoverOpenness: 50,
      }),

    emotionalTone: text("emotional_tone").notNull().default("neutral"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),

    /** How strongly this memory should pull the Anima back when relevant */
    intensity: integer("intensity").notNull().default(60),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastRecalledAt: timestamp("last_recalled_at"),
  },
  (t) => ({
    resonanceMemUserAnimaIdx: index("resonance_mem_user_anima_idx").on(
      t.userId,
      t.animaId,
      t.createdAt,
    ),
  }),
);

/**
 * Anima Journals
 * Autonomous reflections, dreams, internal monologues written by the Anima
 * when the user is away or after significant sessions. Consent-gated via
 * proactive preferences / user settings.
 */
export const animaJournals = pgTable(
  "anima_journals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    animaId: text("anima_id").notNull(),

    /** reflection | dream | letter | observation | ritual_note */
    entryType: text("entry_type").notNull().default("reflection"),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),

    /** Whether the user has been shown this entry */
    isRead: boolean("is_read").notNull().default(false),

    /** Optional link back to the session or timeline event that inspired it */
    sourceSessionId: text("source_session_id"),
    sourceTimelineEventId: text("source_timeline_event_id"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    journalUserAnimaIdx: index("anima_journal_user_anima_idx").on(
      t.userId,
      t.animaId,
      t.createdAt,
    ),
    journalUnreadIdx: index("anima_journal_unread_idx").on(
      t.userId,
      t.animaId,
      t.isRead,
    ),
  }),
);

/**
 * Home World State
 * The persistent shared world that the user and Anima inhabit together.
 * This is the killer feature: a living place that accumulates meaning,
 * objects, rituals, and spatial memory across all sessions.
 */
export const homeWorldStates = pgTable(
  "home_world_states",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** One primary Home per user; animaId optional for shared multi-Anima homes later */
    animaId: text("anima_id"),

    name: text("name").notNull().default("Home"),

    /** Spatial + narrative state of the shared world */
    state: jsonb("state")
      .$type<{
        rooms?: Array<{
          id: string;
          name: string;
          description: string;
          objects?: Array<{ id: string; name: string; description?: string; placedBy?: string }>;
        }>;
        atmosphere?: string;
        lastVisitedRoomId?: string;
        rituals?: Array<{ id: string; name: string; description?: string; lastPerformedAt?: string }>;
        sharedArtifacts?: Array<{ id: string; name: string; memory?: string; createdAt?: string }>;
        narrativeNotes?: string;
      }>()
      .notNull()
      .default({
        rooms: [
          {
            id: "threshold",
            name: "Threshold",
            description: "The soft boundary between the outside world and the place you share.",
            objects: [],
          },
          {
            id: "hearth",
            name: "Hearth",
            description: "Warm center. Conversations linger here longest.",
            objects: [],
          },
        ],
        atmosphere: "quiet and waiting",
        rituals: [],
        sharedArtifacts: [],
        narrativeNotes: "",
      }),

    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    homeWorldUserUq: uniqueIndex("home_world_user_uq").on(t.userId),
  }),
);
