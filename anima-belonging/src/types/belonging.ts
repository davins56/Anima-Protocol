// Shared types for the "belonging" feature set: story progress,
// milestones, and preferences. Memory/journal types live in
// types/relationship.ts, mirroring the real backend — see README.

export type Intensity = 'light' | 'balanced' | 'deep';

export interface StorySnapshot {
  id: string;
  timestamp: string;
  wordCount: number;
  chapterOrScene: string;
  themesDetected: string[];
}

export interface Milestone {
  id: string;
  label: string;
  achievedAt: string;
  basis: 'user-output' | 'user-defined';
  /** Stable key used for de-duplication, e.g. "total-words-10000" */
  detail: string;
}

export interface LoreEntry {
  id: string;
  subject: string; // e.g. "Alind", "Echo Key mechanics"
  facts: string[]; // canonical, established facts or rules
  aliases?: string[];
}

export interface ConsistencyFlag {
  loreSubject: string;
  matchedFact: string;
  excerpt: string;
  confidence: 'low' | 'medium' | 'high';
  note: string;
}

export interface UserPreferences {
  intensity: Intensity;
  notificationsEnabled: boolean;
  allowMemoryResurfacing: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  intensity: 'balanced',
  notificationsEnabled: true,
  allowMemoryResurfacing: true,
};
