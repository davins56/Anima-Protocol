/** Shapes returned by /api/deepnet (see artifacts/api-server/src/routes/deepnet.ts, #757). */
export type BandKey = "noise" | "ambient" | "data" | "rare" | "serenity";

export type DeepnetMapNode = {
  id: string;
  kind: "gate" | "corridor" | "relay" | "signal_lost";
  label_key: string;
  label: string;
  band: BandKey;
  pos: [number, number];
  locked: boolean;
};

export type DeepnetMap = {
  version: string;
  nodes: DeepnetMapNode[];
  edges: { from: string; to: string; state: "open" | "locked" }[];
};

export type QuestStep = "entered" | "encounter_met" | "decision_made" | "resolved";
export type Outcome = "clean" | "partial" | "dissonant";

export type QuestView = {
  quest_id: string;
  content_version: string;
  bond_tier: string;
  state: {
    step: QuestStep | null;
    seq: number;
    outcome: Outcome | null;
    events: { seq: number; step: QuestStep; band?: BandKey; bandGap?: number; outcome?: Outcome; optionId?: string; tunedW?: number }[];
  };
  corridor: {
    id: string;
    name: string;
    description: string;
    ambient_band: BandKey;
    segments: { id: string; kind: "entry" | "encounter" | "gate" | "exit"; label: string; at: number; requires: QuestStep | null }[];
  };
  dialogue: {
    id: string;
    start: string;
    nodes: { id: string; speaker: string; line: string; choices: { id: string; label: string; next: string }[] }[];
  };
  gate: { id: string; band: BandKey; prompt: string; options: { id: string; label: string; min_tier: string; available: boolean }[] };
};
