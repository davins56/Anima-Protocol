import { describe, expect, it } from "vitest";
import {
  cuePhrase,
  cuesForSurface,
  groupCuesFromPayload,
  isPublicCue,
  isReunionCue,
  listenerCuesForCast,
  provisionalCueFromFrame,
  reunionAlreadySeen,
  reunionKey,
  REUNION_BUCKET_SUPPRESS_MS,
  sanitizeAffectCue,
} from "./emotionCues";
import { stripMachineTags, stripMachineTagsStreaming } from "./machineTags";
import { groupEmotionFixtures } from "./emotionCues.group.fixtures";

const F = groupEmotionFixtures();
const cast = ["c_nat", "c_ser"];

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe("group cues come only from the public group_affect projection", () => {
  it("before a public update: baseline-only cues, and the private companion_affect is never read", () => {
    const ctx = F.context.group_before_public_update;
    const cues = groupCuesFromPayload(ctx.group_affect, { castIds: cast });
    expect(Object.keys(cues)).toEqual(["c_nat", "c_ser"]);
    for (const id of cast) {
      expect(cues[id].dims).toEqual(F.baseline_dims);
      expect(cues[id].undertone).toBeNull();
      expect(cues[id].since_last).toBeNull();
      expect(cuePhrase(cues[id], "Natasha")).toBe("Natasha seems settled");
    }
    // The composed grief + reunion in companion_affect must not surface anywhere.
    expect(JSON.stringify(cues)).not.toMatch(/grief|days/);
  });

  it("after a public update: the updated public cue; cast members only", () => {
    const cues = groupCuesFromPayload(F.context.group_after_public_update.group_affect, { castIds: cast });
    expect(Object.keys(cues)).toEqual(["c_nat", "c_ser"]);
    expect(cues.c_nat.undertone).toEqual({ kind: "glow", intensity: 30 });
    expect(cues.c_ser.undertone).toBeNull();
  });

  it("requires layer:'public' (missing or composed layer fails closed)", () => {
    expect(groupCuesFromPayload(F.context.group_layer_missing_or_composed.group_affect, { castIds: cast })).toEqual({});
    expect(groupCuesFromPayload(null, { castIds: cast })).toEqual({});
    expect(groupCuesFromPayload(F.context.group_before_public_update.companion_affect, { castIds: cast })).toEqual({});
  });

  it("surface filter: group keeps public only; solo keeps the composed header cue", () => {
    const composed = sanitizeAffectCue(F.context.solo_composed_with_committed_gap.companion_affect.c_nat);
    const pub = sanitizeAffectCue(F.context.group_after_public_update.group_affect.c_nat);
    expect(isPublicCue(pub)).toBe(true);
    expect(isPublicCue(composed)).toBe(false);
    expect(cuesForSurface({ a: composed, b: pub }, { group: true })).toEqual({ b: pub });
    expect(cuesForSurface({ a: composed }, { group: false })).toEqual({ a: composed });
  });
});

describe("done frames (committed)", () => {
  it("group_affect + listener_affect: listeners only, never the speaker, public only", () => {
    const done = F.done.group_turn;
    const listeners = listenerCuesForCast(done.listener_affect, { castIds: cast, speakerId: done.assistant_character_id });
    expect(Object.keys(listeners)).toEqual(["c_ser"]);
    expect(listeners.c_ser.undertone).toEqual({ kind: "glow", intensity: 20 });
    expect(Object.keys(groupCuesFromPayload(done.group_affect, { castIds: cast }))).toEqual(["c_nat", "c_ser"]);
  });

  it("a composed snapshot in a group done never reaches the group UI", () => {
    const done = F.done.group_turn_private_leak_attempt;
    expect(listenerCuesForCast(done.listener_affect, { castIds: cast, speakerId: "c_nat" })).toEqual({});
    const speaker = sanitizeAffectCue(done.companion_affect);
    expect(cuesForSurface({ c_nat: speaker }, { group: true })).toEqual({});
  });
});

describe("since_last only from committed payloads", () => {
  it("never from the early provisional frame", () => {
    const p = provisionalCueFromFrame(F.early_frame.with_forbidden_since_last, { castIds: cast });
    expect(p.cue.since_last).toBeNull();
    expect(isReunionCue(p.cue)).toBe(false);
  });

  it("an early frame keeps its layer so a group can drop a composed tint", () => {
    expect(isPublicCue(provisionalCueFromFrame(F.early_frame.group_public, { castIds: cast }).cue)).toBe(true);
    expect(isPublicCue(provisionalCueFromFrame(F.early_frame.group_composed, { castIds: cast }).cue)).toBe(false);
  });

  it("present in done / context means confirmed", () => {
    expect(isReunionCue(sanitizeAffectCue(F.done.solo_committed_reunion.companion_affect))).toBe(true);
    expect(isReunionCue(sanitizeAffectCue(F.context.solo_composed_with_committed_gap.companion_affect.c_nat))).toBe(true);
  });
});

describe("reunion shows once per committed checkpoint", () => {
  it("keys by the checkpoint turn id, else the done turn id, else the bucket", () => {
    const ctxCue = sanitizeAffectCue(F.context.solo_composed_with_committed_gap.companion_affect.c_nat);
    expect(reunionKey("s1", "c_nat", ctxCue)).toBe("s1:c_nat:turn:turn_ckpt_1");
    const noId = { ...ctxCue, since_last: { bucket: "days", first_turn: true } };
    expect(reunionKey("s1", "c_nat", noId, "turn_s_3")).toBe("s1:c_nat:turn:turn_s_3");
    expect(reunionKey("s1", "c_nat", noId)).toBe("s1:c_nat:bucket:days");
    expect(reunionKey("s1", "c_nat", noId, "bad id with spaces")).toBe("s1:c_nat:bucket:days");
  });

  it("repeated context reads (and reloads) do not replay it", () => {
    const storage = memoryStorage();
    const key = "s1:c_nat:turn:turn_ckpt_1";
    expect(reunionAlreadySeen(key, { storage, now: 1000 })).toBe(false);
    expect(reunionAlreadySeen(key, { storage, now: 2000 })).toBe(true);
    expect(reunionAlreadySeen(key, { storage, now: 10 ** 12 })).toBe(true);
  });

  it("a bucket-only key is suppressed for a bounded window", () => {
    const storage = memoryStorage();
    const key = "s1:c_nat:bucket:days";
    expect(reunionAlreadySeen(key, { storage, now: 0 })).toBe(false);
    expect(reunionAlreadySeen(key, { storage, now: REUNION_BUCKET_SUPPRESS_MS - 1 })).toBe(true);
    expect(reunionAlreadySeen(key, { storage, now: REUNION_BUCKET_SUPPRESS_MS + 1 })).toBe(false);
  });

  it("storage failures never throw", () => {
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(reunionAlreadySeen("k", { storage: broken })).toBe(false);
    expect(reunionAlreadySeen("k", { storage: null })).toBe(false);
  });
});

describe("expression: instrumentation stripped, emotional language and emoji kept", () => {
  it("stream and storage share one chunk-safe transform", () => {
    const text = F.text.instrumented_reply;
    expect(stripMachineTags(text)).toBe(F.text.visible_reply);
    for (let i = 1; i <= text.length; i += 1) {
      const view = stripMachineTagsStreaming(text.slice(0, i));
      expect(view).not.toMatch(/\[EMOTION|\[\[/);
    }
    expect(stripMachineTags(stripMachineTagsStreaming(text))).toBe(F.text.visible_reply);
  });
});
