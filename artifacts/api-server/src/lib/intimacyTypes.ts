export interface IntimacyAnatomy {
  genitals?: string;
  preferences?: string[];
  [key: string]: unknown;
}

export interface IntimacyProfile {
  id?: string;
  userId: string;
  characterId: string;
  intimacyEnabled: boolean;
  preferredPace: "slow" | "normal" | "fast";
  safeword: string;
  aftercareStyle: string;
  powerAxis: number;
  kinks: string[];
  limits: string[];
  softLimits: string[];
  anatomy?: IntimacyAnatomy;
  lastSceneAt?: string;
  heat: number;
}

export interface IntimacyScene {
  id?: string;
  conversationId: string;
  characterId: string;
  userId: string;
  endedReason?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface IntimacyTurnResult {
  blockIntimacy: boolean;
  events: string[];
  phase: "closed" | "tension" | "contact" | "peak" | "aftercare";
  heat: number;
  profile: IntimacyProfile;
  scene?: IntimacyScene;
}
