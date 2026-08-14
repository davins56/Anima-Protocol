import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { relationshipTimelineEvents } from "../db/schema";

export type TimelineEventType =
  | "event"
  | "milestone"
  | "chapter"
  | "emotional_shift"
  | "ritual"
  | "first"
  | "breakthrough";

export type TimelineEventInput = {
  userId: string;
  animaId: string;
  sessionId?: string | null;
  eventType?: TimelineEventType;
  title: string;
  summary?: string;
  payload?: Record<string, unknown>;
  significance?: number;
  occurredAt?: Date;
};

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isMissingRelationError(err: unknown): boolean {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "object" && "code" in current && (current as { code?: unknown }).code === "42P01") {
      return true;
    }
    current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export async function appendTimelineEvent(input: TimelineEventInput) {
  try {
    const id = makeId();
    const row = {
      id,
      userId: input.userId,
      animaId: input.animaId,
      sessionId: input.sessionId ?? null,
      eventType: input.eventType ?? "event",
      title: input.title,
      summary: input.summary ?? "",
      payload: input.payload ?? {},
      significance: Math.max(0, Math.min(100, input.significance ?? 50)),
      occurredAt: input.occurredAt ?? new Date(),
      createdAt: new Date(),
    };
    await db.insert(relationshipTimelineEvents).values(row);
    return row;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

export async function loadTimelineEvents(params: {
  userId: string;
  animaId: string;
  limit?: number;
  eventType?: TimelineEventType;
}) {
  try {
    const limit = Math.min(Math.max(params.limit ?? 40, 1), 200);
    const conditions = [
      eq(relationshipTimelineEvents.userId, params.userId),
      eq(relationshipTimelineEvents.animaId, params.animaId),
    ];
    if (params.eventType) conditions.push(eq(relationshipTimelineEvents.eventType, params.eventType));
    return await db
      .select()
      .from(relationshipTimelineEvents)
      .where(and(...conditions))
      .orderBy(desc(relationshipTimelineEvents.occurredAt))
      .limit(limit);
  } catch (err) {
    if (isMissingRelationError(err)) return [];
    throw err;
  }
}

export async function recordRelationshipMilestone(params: {
  userId: string;
  animaId: string;
  conversationCount: number;
  summary: string;
  delta?: Record<string, unknown>;
}) {
  return appendTimelineEvent({
    userId: params.userId,
    animaId: params.animaId,
    eventType: "milestone",
    title: `Relationship milestone · ${params.conversationCount} conversations`,
    summary: params.summary,
    payload: { conversationCount: params.conversationCount, delta: params.delta ?? null },
    significance: Math.min(100, 40 + Math.floor(params.conversationCount / 10)),
  });
}

export async function openRelationshipChapter(params: {
  userId: string;
  animaId: string;
  title: string;
  summary?: string;
  chapterIndex?: number;
}) {
  return appendTimelineEvent({
    userId: params.userId,
    animaId: params.animaId,
    eventType: "chapter",
    title: params.title,
    summary: params.summary ?? "",
    payload: { chapterIndex: params.chapterIndex ?? null },
    significance: 85,
  });
}
