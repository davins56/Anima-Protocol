// Mirrors the real shapes from artifacts/api-server/src/lib/
// (relationshipTimeline.ts, resonanceMemories.ts, animaJournal.ts).
// Nothing invented here — these match the actual row/route shapes.

export type ResonanceVector = {
  intimacy: number; // 0-100
  powerDynamic: number; // -50..50
  spiritualAttunement: number; // 0-100
  primalIntensity: number; // 0-100
  crossoverOpenness: number; // 0-100
};

export type TimelineEventType =
  | 'event'
  | 'milestone'
  | 'chapter'
  | 'emotional_shift'
  | 'ritual'
  | 'first'
  | 'breakthrough';

export interface TimelineEvent {
  id: string;
  userId: string;
  animaId: string;
  sessionId: string | null;
  eventType: TimelineEventType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  significance: number;
  occurredAt: string;
  createdAt: string;
}

export interface ResonanceMemory {
  id: string;
  userId: string;
  animaId: string;
  sessionId: string | null;
  title: string;
  body: string;
  resonanceSnapshot: ResonanceVector;
  emotionalTone: string;
  tags: string[];
  intensity: number;
  createdAt: string;
  lastRecalledAt: string | null;
}

export type JournalEntryType = 'reflection' | 'dream' | 'letter' | 'observation' | 'ritual_note';

export interface JournalEntry {
  id: string;
  userId: string;
  animaId: string;
  entryType: JournalEntryType;
  title: string;
  content: string;
  isRead: boolean;
  sourceSessionId: string | null;
  sourceTimelineEventId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
