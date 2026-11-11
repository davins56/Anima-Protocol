import { describe, expect, it } from "vitest";
import { createSim, replay, stateHash, validateLog, type SimConfig } from "@workspace/sim-core";
import { enemiesForNode } from "../src/lib/sim/simStore";
import { formatMemoryCoreBlock } from "../src/lib/memoryCore/sessionContext";

describe("sim session config", () => {
  it("homes viruses on the node's band; hostile nodes field two", () => {
    expect(enemiesForNode({ frequency: 8, signalType: "noise", seed: 3 })).toHaveLength(1);
    const e = enemiesForNode({ frequency: 60, signalType: "hostile", seed: 3 });
    expect(e.map((x) => x.band)).toEqual(["data", "noise"]);
  });

  it("server replay agrees with the client engine", () => {
    const config: SimConfig = { seed: 99, companionId: "serenity", startW: 94, enemies: enemiesForNode({ frequency: 12, signalType: "hostile", seed: 99 }), memoryPool: ["a", "b"] };
    const actions = [
      { tick: 0, action: { t: "custom_open" as const } },
      { tick: 0, action: { t: "custom_pick" as const, picks: [0, 1, 2] } },
      { tick: 12, action: { t: "chip" as const } },
      { tick: 40, action: { t: "phase" as const, toW: 60 } },
    ];
    const client = replay(config, actions, 120).state;
    const v = validateLog(config, actions, { tick: 120, hash: stateHash(client) });
    expect(v.ok).toBe(true);
    expect(createSim(config).config.memoryPool).toEqual(["a", "b"]);
  });
});

describe("corrupted memories in the prompt", () => {
  it("are shown only as an obscured fragment; clean ones verbatim", () => {
    const now = Date.parse("2026-10-22T00:00:00Z");
    const base = { conversation_id: null, occurred_at: "2026-10-20T00:00:00Z", emotional_weight: 0.5, similarity: null, recency: 1, score: 1, event_type: "turn" };
    const block = formatMemoryCoreBlock(
      null,
      [
        { ...base, id: "1", content: "we named a star together", payload: {} },
        { ...base, id: "2", content: "the night by the river when you told me your fear", payload: { corrupted: { severity: 0.6 } } },
      ],
      now,
    );
    expect(block).toContain("we named a star together");
    expect(block).toContain("[signal corrupted · 60%]");
    expect(block).not.toContain("the night by the river when you told me your fear");
  });
});
