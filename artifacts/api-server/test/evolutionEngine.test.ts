import { describe, expect, it } from "vitest";
import { qualifyingEvolutionMilestone } from "../src/lib/evolutionEngine";

describe("qualifyingEvolutionMilestone", () => {
  it("returns null before the first milestone", () => {
    expect(
      qualifyingEvolutionMilestone({ conversationCount: 49, alreadyMilestone: 0 }),
    ).toBeNull();
  });

  it("fires the lowest milestone when a count lands on it", () => {
    expect(
      qualifyingEvolutionMilestone({ conversationCount: 50, alreadyMilestone: 0 }),
    ).toBe(50);
  });

  it("still fires after a retry/batch jumps past the exact count", () => {
    expect(
      qualifyingEvolutionMilestone({ conversationCount: 51, alreadyMilestone: 0 }),
    ).toBe(50);
  });

  it("does not re-fire a milestone that already applied", () => {
    expect(
      qualifyingEvolutionMilestone({ conversationCount: 51, alreadyMilestone: 50 }),
    ).toBeNull();
  });

  it("picks the next unapplied milestone after a larger jump", () => {
    expect(
      qualifyingEvolutionMilestone({ conversationCount: 101, alreadyMilestone: 50 }),
    ).toBe(100);
  });
});
