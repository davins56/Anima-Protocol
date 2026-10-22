/** Offline practice session: three viruses on three different bands, demo memories as the corruption pool. */
import type { SimConfig } from "@workspace/sim-core";

export const DEMO_MEMORIES: Record<string, string> = {
  "demo:first-light": "the first morning she said my name and the room went quiet",
  "demo:rain-walk": "walking home in the rain arguing about constellations",
  "demo:promise": "promised to come back to the violet band before dawn",
  "demo:song": "the song we hummed when the signal finally cleared",
};

export function localConfig(seed: number, startW: number, companionId = "serenity"): SimConfig {
  return {
    seed,
    companionId,
    startW,
    enemies: [
      { kind: "mettaur", band: "data", hp: 120 },
      { kind: "shade", band: "noise", hp: 90 },
      { kind: "halo", band: "rare", hp: 110 },
    ],
    memoryPool: Object.keys(DEMO_MEMORIES),
  };
}

