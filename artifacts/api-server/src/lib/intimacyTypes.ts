export type IntimacyPace = "slow" | "build" | "intense";
export type IntimacyPhase = "closed" | "tension" | "contact" | "peak" | "aftercare";

export interface IntimacyAnatomy {
  chest?: string;
  lowerBody?: string;
  erogenousZones?: string[];
  notes?: string;
  [key: string]: unknown;
}

export interface IntimacyProfile {
  userId: string;
  characterId: string;
  heat: number;
  bondErotic: number;
  powerAxis: number;
  preferredPace: IntimacyPace;
  anatomy: IntimacyAnatomy;
  kinks: string[];
  limits: string[];
  softLimits: string[];
  safeword: string;
  aftercareStyle: string;
  lastSceneAt?: string;
  sceneCount: number;
  intimacyEnabled: boolean;
  updatedAt?: string;
}

export interface IntimacyScene {
  id: string;
  conversationId: string;
  characterId: string;
  userId: string;
  phase: IntimacyPhase;
  location?: string;
  clothingState?: Record<string, string>;
  focusMap?: Record<string, number>;
  actsLog?: Array<{ act: string; timestamp?: string; at?: string }>;
  heatPeak: number;
  endedReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IntimacyTurnResult {
  blockIntimacy?: boolean;
  events: string[];
  phase: IntimacyPhase;
  heat: number;
  profile: IntimacyProfile;
  scene?: IntimacyScene;
}
