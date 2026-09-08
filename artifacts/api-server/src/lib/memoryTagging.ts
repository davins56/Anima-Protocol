import type { IntimacyTurnResult } from "./intimacyTypes";

export type MemoryFact = {
  text: string;
  memory_type: string;
  subject?: string;
  weight?: number;
};

export function eroticMemoryFacts(result: IntimacyTurnResult, companionName: string): MemoryFact[] {
  const facts: MemoryFact[] = [];
  if (result.blockIntimacy) return facts;

  if (result.events.includes("safeword") || result.events.some((e) => e.startsWith("hard_limit:"))) {
    facts.push({
      text: `${companionName} honored a hard stop and moved to aftercare.`,
      memory_type: "boundary",
      subject: companionName,
      weight: 1,
    });
  }

  const soft = result.events.find((e) => e.startsWith("soft_limit:"));
  if (soft) {
    facts.push({
      text: `${companionName} noted a soft limit (${soft.slice(11)}) and did not push it.`,
      memory_type: "boundary",
      subject: companionName,
      weight: 0.8,
    });
  }

  if (result.phase === "peak" && result.heat >= 82) {
    facts.push({
      text: `A high-heat scene with ${companionName} reached peak. Pace ${result.profile.preferredPace}.`,
      memory_type: "erotic_moment",
      subject: companionName,
      weight: 0.7,
    });
  }

  if (result.phase === "aftercare" && result.scene?.endedReason !== "safeword") {
    facts.push({
      text: `Aftercare with ${companionName}: ${result.profile.aftercareStyle}`,
      memory_type: "aftercare",
      subject: companionName,
      weight: 0.6,
    });
  }

  return facts;
}
