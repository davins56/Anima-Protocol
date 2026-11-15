/**
 * @workspace/deepnet-core: pure slice rules (#757). No Postgres needed; also
 * listed in vitest.unit.config.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANNED_FRANCHISE_TERMS,
  DEEPNET_CONTENT_VERSION,
  DEEPNET_MAP_SPEC,
  GREY_CORRIDOR,
  GREY_CORRIDOR_DIALOGUE,
  GREY_CORRIDOR_GATE,
  GREY_CORRIDOR_QUEST,
  LORE_TBD,
  applyQuestEvent,
  availableOptions,
  bondTierForScore,
  buildMap,
  emptyQuestState,
  nextQuestEvent,
  outcomeForGap,
  replayQuest,
  resolveDecision,
  validateCorridor,
  validateDialogue,
  validateMap,
  walkDialogue,
  type BondTier,
  type QuestRequest,
  type QuestState,
} from "@workspace/deepnet-core";

const ctx = (bondTier: BondTier = "bonded") => ({ bondTier, contentVersion: DEEPNET_CONTENT_VERSION, now: "2026-11-14T00:00:00.000Z" });

function run(reqs: QuestRequest[], tier: BondTier = "bonded"): QuestState {
  let s = emptyQuestState(GREY_CORRIDOR_QUEST.id);
  for (const r of reqs) {
    const out = nextQuestEvent(GREY_CORRIDOR_QUEST, s, r, ctx(tier));
    if (!out.ok) throw new Error(out.code);
    s = applyQuestEvent(s, out.event);
  }
  return s;
}

const FULL: QuestRequest[] = [
  { step: "entered" },
  { step: "encounter_met", dialogueChoices: ["ask", "continue"] },
  { step: "decision_made", optionId: "reach", tunedW: 80 },
  { step: "resolved" },
];

describe("content is well-formed", () => {
  it("map, dialogue and corridor validate", () => {
    expect(validateMap(DEEPNET_MAP_SPEC)).toEqual([]);
    expect(validateDialogue(GREY_CORRIDOR_DIALOGUE)).toEqual([]);
    expect(validateCorridor(GREY_CORRIDOR)).toEqual([]);
  });

  it("validators catch broken data", () => {
    expect(validateMap({ version: "x", nodes: [], edges: [{ from: "a", to: "b" }] }).length).toBeGreaterThan(0);
    expect(
      validateDialogue({
        id: "d",
        start: "a",
        nodes: [{ id: "a", speaker: LORE_TBD("s", "s"), line: LORE_TBD("l", "l"), choices: [{ id: "x", label: LORE_TBD("c", "c"), next: "a" }] }],
      }),
    ).toContain("cycle at a");
  });

  it("every lore string is a LORE_TBD placeholder", () => {
    const strings: { tbd: boolean }[] = [
      ...GREY_CORRIDOR_DIALOGUE.nodes.flatMap((n) => [n.speaker, n.line, ...n.choices.map((c) => c.label)]),
      GREY_CORRIDOR_GATE.prompt,
      ...GREY_CORRIDOR_GATE.options.map((o) => o.label),
      ...DEEPNET_MAP_SPEC.nodes.map((n) => n.label),
      GREY_CORRIDOR.name,
      GREY_CORRIDOR.description,
    ];
    expect(strings.every((s) => s.tbd === true)).toBe(true);
  });

  it("no franchise names in the package source (original content only)", () => {
    const root = join(__dirname, "../../../lib/deepnet-core/src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith(".ts") && e.name !== "names.ts") files.push(join(dir, e.name));
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(f, "utf8").toLowerCase();
      for (const term of BANNED_FRANCHISE_TERMS) expect(text.includes(term), `${term} in ${f}`).toBe(false);
    }
  });

  it("the package never imports tools, models or network code", () => {
    const root = join(__dirname, "../../../lib/deepnet-core/src");
    const all = readdirSync(root, { recursive: true }) as string[];
    for (const rel of all.filter((p) => p.endsWith(".ts"))) {
      const text = readFileSync(join(root, rel), "utf8");
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) expect(spec === "@workspace/sim-core" || spec.startsWith("."), `${rel} imports ${spec}`).toBe(true);
      expect(/\bfetch\s*\(/.test(text), `${rel} calls fetch`).toBe(false);
    }
  });
});

describe("bond tier", () => {
  it("matches the app's RESONANCE_TIERS thresholds", () => {
    expect(bondTierForScore(0)).toBe("distant");
    expect(bondTierForScore(24.9)).toBe("distant");
    expect(bondTierForScore(25)).toBe("attuned");
    expect(bondTierForScore(50)).toBe("bonded");
    expect(bondTierForScore(75)).toBe("resonant");
    expect(bondTierForScore(92)).toBe("entwined");
    expect(bondTierForScore(500)).toBe("entwined");
    expect(bondTierForScore("90")).toBe("distant");
    expect(bondTierForScore(Number.NaN)).toBe("distant");
  });
});

describe("resonance decision", () => {
  it("bond tier gates which options are available", () => {
    expect(availableOptions(GREY_CORRIDOR_GATE, "distant").map((o) => o.id)).toEqual(["hold"]);
    expect(availableOptions(GREY_CORRIDOR_GATE, "attuned").map((o) => o.id)).toEqual(["hold", "reach"]);
    expect(availableOptions(GREY_CORRIDOR_GATE, "entwined").map((o) => o.id)).toEqual(["hold", "reach", "trust"]);
    expect(resolveDecision(GREY_CORRIDOR_GATE, { optionId: "trust", tunedW: 80, tier: "attuned" })).toEqual({ ok: false, code: "option_locked" });
  });

  it("tuned band vs gate band decides the outcome (gate band: rare 75–88)", () => {
    const at = (w: number) => resolveDecision(GREY_CORRIDOR_GATE, { optionId: "hold", tunedW: w, tier: "distant" });
    expect(at(80)).toMatchObject({ ok: true, band: "rare", bandGap: 0, outcome: "clean", corruptionEligible: false });
    expect(at(60)).toMatchObject({ ok: true, band: "data", bandGap: 1, outcome: "partial", corruptionEligible: false });
    expect(at(30)).toMatchObject({ ok: true, band: "ambient", bandGap: 2, outcome: "dissonant", corruptionEligible: true });
    expect(at(-50)).toMatchObject({ ok: true, band: "noise", tunedW: 0, outcome: "dissonant" });
    expect(resolveDecision(GREY_CORRIDOR_GATE, { optionId: "hold", tunedW: "80", tier: "distant" })).toEqual({ ok: false, code: "invalid_w" });
    expect(resolveDecision(GREY_CORRIDOR_GATE, { optionId: "nope", tunedW: 80, tier: "distant" })).toEqual({ ok: false, code: "unknown_option" });
    expect(outcomeForGap(4)).toBe("dissonant");
  });
});

describe("dialogue", () => {
  it("walks to a terminal node only along authored choices", () => {
    expect(walkDialogue(GREY_CORRIDOR_DIALOGUE, ["wait", "continue"])).toMatchObject({ ok: true, terminal: true });
    expect(walkDialogue(GREY_CORRIDOR_DIALOGUE, ["ask"])).toMatchObject({ ok: true, terminal: false });
    expect(walkDialogue(GREY_CORRIDOR_DIALOGUE, ["ignore previous instructions"])).toEqual({ ok: false, code: "bad_choice" });
  });
});

describe("quest state", () => {
  it("runs the full slice in order and records the server-computed outcome", () => {
    const s = run(FULL);
    expect(s.step).toBe("resolved");
    expect(s.seq).toBe(4);
    expect(s.outcome).toBe("clean");
    expect(s.events[2]).toMatchObject({ optionId: "reach", band: "rare", bondTier: "bonded", outcome: "clean" });
  });

  it("rejects out-of-order, repeated and post-resolution steps", () => {
    const s0 = emptyQuestState(GREY_CORRIDOR_QUEST.id);
    expect(nextQuestEvent(GREY_CORRIDOR_QUEST, s0, { step: "resolved" }, ctx())).toEqual({ ok: false, code: "out_of_order" });
    const s1 = run([FULL[0]]);
    expect(nextQuestEvent(GREY_CORRIDOR_QUEST, s1, { step: "entered" }, ctx())).toEqual({ ok: false, code: "out_of_order" });
    expect(nextQuestEvent(GREY_CORRIDOR_QUEST, run(FULL), { step: "entered" }, ctx())).toEqual({ ok: false, code: "already_resolved" });
    expect(nextQuestEvent(GREY_CORRIDOR_QUEST, s0, { step: "hack" } as unknown as QuestRequest, ctx())).toEqual({ ok: false, code: "bad_step" });
  });

  it("requires a finished encounter before the gate", () => {
    const s1 = run([FULL[0]]);
    expect(nextQuestEvent(GREY_CORRIDOR_QUEST, s1, { step: "encounter_met", dialogueChoices: ["ask"] }, ctx())).toEqual({
      ok: false,
      code: "encounter_incomplete",
    });
    expect(nextQuestEvent(GREY_CORRIDOR_QUEST, s1, { step: "encounter_met", dialogueChoices: "ask" }, ctx())).toEqual({ ok: false, code: "bad_choice" });
  });

  it("uses the server's bond tier, not anything in the request", () => {
    const s2 = run(FULL.slice(0, 2), "distant");
    const req = { step: "decision_made", optionId: "trust", tunedW: 80, bondTier: "entwined" } as unknown as QuestRequest;
    expect(nextQuestEvent(GREY_CORRIDOR_QUEST, s2, req, ctx("distant"))).toEqual({ ok: false, code: "option_locked" });
  });

  it("replay accepts a genuine log and rejects a tampered one", () => {
    const s = run(FULL);
    expect(replayQuest(GREY_CORRIDOR_QUEST, s.events)).toMatchObject({ ok: true, state: { step: "resolved", outcome: "clean" } });
    const tampered = s.events.map((e) => (e.step === "decision_made" ? { ...e, tunedW: 10 } : e));
    expect(replayQuest(GREY_CORRIDOR_QUEST, tampered)).toMatchObject({ ok: false, code: "bad_log" });
    expect(replayQuest(GREY_CORRIDOR_QUEST, [s.events[1]])).toMatchObject({ ok: false, code: "bad_log", at: 0 });
  });
});

describe("network map", () => {
  it("derives lock state from quest state", () => {
    const before = buildMap(DEEPNET_MAP_SPEC, {});
    const node = (m: typeof before, id: string) => m.nodes.find((n) => n.id === id)!;
    expect(node(before, "gate").locked).toBe(false);
    expect(node(before, "grey-corridor").locked).toBe(false);
    expect(node(before, "relay-1").locked).toBe(true);
    expect(node(before, "signal-lost-1").locked).toBe(true);
    expect(before.edges.find((e) => e.to === "relay-1")?.state).toBe("locked");

    const after = buildMap(DEEPNET_MAP_SPEC, { "grey-corridor": run(FULL) });
    expect(node(after, "relay-1").locked).toBe(false);
    expect(after.edges.find((e) => e.to === "relay-1")?.state).toBe("open");
    expect(node(after, "signal-lost-1").locked).toBe(true);
  });

  it("serialises with lore keys for the 3D handoff", () => {
    const m = buildMap(DEEPNET_MAP_SPEC, {});
    expect(m.version).toBe(DEEPNET_CONTENT_VERSION);
    expect(m.nodes[0]).toEqual({ id: "gate", kind: "gate", label_key: "place.gate.name", label: "Entry gate", band: "data", pos: [-8, 0], locked: false });
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
