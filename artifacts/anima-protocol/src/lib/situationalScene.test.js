import { describe, expect, it } from "vitest";
import {
  applyScenePatch,
  blockedFromServer,
  blockedNotice,
  castPatch,
  castRows,
  heardByCaption,
  heardByFromRow,
  isSceneCommand,
  isSceneConflictError,
  isSceneEventRow,
  isScenePlanStaleError,
  isScenesDisabledError,
  mergeSceneEventRows,
  nextPlanFollow,
  normalizeScene,
  planRequestFields,
  sceneEventMeta,
  sceneEventRow,
  sceneFromErrorPayload,
  scenePlanFromFrame,
  sceneStageDirection,
  sceneSummaryLine,
  scenesEnabledFromContext,
  withoutSceneEvents,
} from "./situationalScene";
import { httpFixtureError, sceneFixtures } from "./situationalScene.fixtures";

const F = sceneFixtures();
const roster = [
  { id: "c_nat", name: "Natasha" },
  { id: "c_ser", name: "Serenity" },
  { id: "c_aeland", name: "Aeland" },
  { id: "c_scarlet", name: "Scarlet" },
];

describe("flag discovery and flag-off fallback", () => {
  it("only scenes_enabled === true turns scenes on", () => {
    expect(scenesEnabledFromContext(F.context.flag_on)).toBe(true);
    expect(scenesEnabledFromContext(F.context.flag_off)).toBe(false);
    expect(scenesEnabledFromContext({ scenes_enabled: "true" })).toBe(false);
    expect(scenesEnabledFromContext(null)).toBe(false);
  });

  it("409 scenes_disabled and 404 (routes not deployed) both mean feature off", () => {
    expect(isScenesDisabledError(httpFixtureError(F.http.scenes_disabled))).toBe(true);
    expect(isScenesDisabledError(httpFixtureError(F.http.routes_missing))).toBe(true);
    expect(isScenesDisabledError(httpFixtureError(F.http.scene_conflict))).toBe(false);
    expect(isScenesDisabledError(httpFixtureError(F.http.scene_plan_stale))).toBe(false);
    expect(isScenesDisabledError({ status: 500 })).toBe(false);
  });

  it("tells scene_conflict and scene_plan_stale apart and reads their { scene }", () => {
    const conflict = httpFixtureError(F.http.scene_conflict);
    const stale = httpFixtureError(F.http.scene_plan_stale);
    expect(isSceneConflictError(conflict)).toBe(true);
    expect(isScenePlanStaleError(conflict)).toBe(false);
    expect(isScenePlanStaleError(stale)).toBe(true);
    expect(sceneFromErrorPayload(stale).rev).toBe(7);
    expect(sceneFromErrorPayload(conflict).mode).toBe("everyone");
  });
});

describe("normalizeScene", () => {
  it("reads the server scene and keeps rev", () => {
    const scene = normalizeScene(F.scene.group_rooftop);
    expect(scene.rev).toBe(4);
    expect(scene.location).toBe("Rooftop");
    expect(scene.cast.c_scarlet).toEqual({ presence: "away", reach: "phone", since: "2026-11-15T17:45:00.000Z", note: "at the archive" });
  });

  it("accepts { scene } wrappers (PATCH / command results)", () => {
    expect(normalizeScene(F.http.patch_result).rev).toBe(5);
  });

  it("adult_gated is authoritative from the server and never inferred from the cast", () => {
    expect(normalizeScene(F.scene.group_rooftop).adult_gated).toBe(true);
    expect(normalizeScene(F.scene.solo_open).adult_gated).toBe(false);
    // Two characters here but no server field: the client does not decide.
    expect(normalizeScene(F.scene.group_no_gate_field).adult_gated).toBeNull();
  });

  it("drops unknown presence values and caps/sanitizes text", () => {
    const scene = normalizeScene({
      location: `${"x".repeat(100)}\u0007`,
      cast: { a: { presence: "levitating" }, b: { presence: "busy", reach: "fax", note: "<b>hi</b>\nthere" } },
    });
    expect(scene.location).toHaveLength(80);
    expect(scene.cast.a).toBeUndefined();
    expect(scene.cast.b.reach).toBe("none");
    expect(scene.cast.b.note).toBe("<b>hi</b> there");
    expect(normalizeScene("nope")).toBeNull();
  });
});

describe("presence list", () => {
  it("participants missing from cast show as here; aspect keys appear only if valid", () => {
    const scene = normalizeScene({ ...F.scene.solo_open, cast: { ...F.scene.solo_open.cast, "aspect:shadow": { presence: "away" }, "aspect:bogus": { presence: "here" }, stranger: { presence: "here" } } });
    const rows = castRows(scene, { participantIds: ["c_nat", "c_ser"], roster, aspectName: (s) => `Aspect ${s}` });
    expect(rows.map((r) => [r.id, r.presence])).toEqual([
      ["c_nat", "here"],
      ["c_ser", "here"],
      ["aspect:shadow", "away"],
    ]);
    expect(rows[2].name).toBe("Aspect shadow");
  });

  it("summary line", () => {
    const scene = normalizeScene(F.scene.group_rooftop);
    const rows = castRows(scene, { participantIds: Object.keys(scene.cast), roster });
    expect(sceneSummaryLine(scene, rows)).toBe("Rooftop · 2 here · 1 away · 1 asleep");
  });

  it("chip actions build one PATCH body each", () => {
    expect(castPatch("c_nat", { presence: "away", note: "getting coffee" })).toEqual({ cast: { c_nat: { presence: "away", note: "getting coffee" } } });
    expect(castPatch("c_nat", { reach: "phone" })).toEqual({ cast: { c_nat: { reach: "phone" } } });
    expect(castPatch("c_nat", { presence: "nope" })).toEqual({ cast: { c_nat: {} } });
  });

  it("optimistic patch never touches rev or adult_gated", () => {
    const scene = normalizeScene(F.scene.group_rooftop);
    const next = applyScenePatch(scene, { location: "Docks", mode: "everyone", cast: { c_aeland: { presence: "here" } }, adult_gated: false, rev: 99 });
    expect(next.location).toBe("Docks");
    expect(next.mode).toBe("everyone");
    expect(next.cast.c_aeland.presence).toBe("here");
    expect(next.rev).toBe(4);
    expect(next.adult_gated).toBe(true);
  });
});

describe("event rows", () => {
  it("only role:'event' is a scene event (not the old type:'event' chips)", () => {
    expect(isSceneEventRow(F.rows.event_exit)).toBe(true);
    expect(isSceneEventRow({ role: "assistant", type: "event", content: "x" })).toBe(false);
  });

  it("reads full persisted rows", () => {
    const row = sceneEventRow(F.rows.event_exit);
    expect(row).toMatchObject({ id: "m_evt_1", seq: 41, role: "event", content: "Scarlet slips away toward the archive.", timestamp: "2026-11-15T18:01:00.000Z" });
    expect(sceneEventMeta(row)).toEqual({ kind: "exit", characterId: "c_scarlet", presence: "away" });
    expect(sceneEventRow({ role: "event", content: "no id" })).toBeNull();
    expect(sceneEventRow({ id: "x", role: "assistant", content: "hi" })).toBeNull();
  });

  it("dedupes by id and keeps seq order", () => {
    const thread = [F.rows.user_heard_by_two, F.rows.user_heard_by_nobody];
    const once = mergeSceneEventRows(thread, [F.rows.event_exit, F.rows.event_exit]);
    expect(once.map((m) => m.id)).toEqual(["m_evt_1", "m_user_1", "m_user_2"]);
    const twice = mergeSceneEventRows(once, [F.rows.event_exit, F.rows.event_enter]);
    expect(twice.map((m) => m.id)).toEqual(["m_evt_1", "m_user_1", "m_user_2", "m_evt_2"]);
    expect(mergeSceneEventRows(twice, [F.rows.event_exit])).toBe(twice);
  });

  it("stage direction for model history; event rows leave the address queue untouched", () => {
    expect(sceneStageDirection(F.rows.event_exit)).toBe("[Scene: Scarlet slips away toward the archive.]");
    const plain = [F.rows.user_heard_by_two];
    expect(withoutSceneEvents(plain)).toBe(plain);
    expect(withoutSceneEvents([F.rows.event_exit, ...plain])).toEqual(plain);
  });
});

describe("heard_by is rendered only from the server stamp", () => {
  it("legacy (absent) and explicit [] are different states", () => {
    expect(heardByFromRow(F.rows.assistant_legacy)).toBeNull();
    expect(heardByFromRow(F.rows.user_heard_by_nobody)).toEqual([]);
    expect(heardByFromRow(F.rows.user_heard_by_two)).toEqual(["c_nat", "c_ser"]);
  });

  it("captions use the stamp verbatim, not the current cast", () => {
    const nameOf = (id) => roster.find((c) => c.id === id)?.name || "Someone";
    expect(heardByCaption(heardByFromRow(F.rows.assistant_legacy), nameOf)).toBeNull();
    expect(heardByCaption([], nameOf)).toBe("Heard by no one");
    expect(heardByCaption(["c_nat", "c_ser"], nameOf)).toBe("Heard by Natasha, Serenity");
    // Even if Scarlet is "here" now, an old row she did not hear stays that way.
    expect(heardByCaption(["c_nat"], nameOf)).toBe("Heard by Natasha");
  });

  it("a malformed stamp is not treated as legacy-all", () => {
    expect(heardByFromRow({ metadata: { heard_by: "everyone" } })).toBeNull();
    expect(heardByFromRow({ metadata: { heard_by: [1, null, "c_nat"] } })).toEqual(["1", "c_nat"]);
  });
});

describe("plans, blocked speakers and if_rev", () => {
  it("reads the scene_plan frame", () => {
    const plan = scenePlanFromFrame(F.sse.user_turn_two_speakers[0].scene_plan);
    expect(plan).toEqual({
      planId: "plan_1",
      speakers: ["c_nat", "c_ser"],
      blocked: [{ id: "c_aeland", presence: "asleep" }],
      narrate: false,
      mode: "natural",
    });
  });

  it("blocked toasts come only from server ids, deduped and sanitized", () => {
    expect(blockedFromServer([{ id: "a", presence: "asleep" }, { id: "a", presence: "asleep" }, { id: "b", presence: "weird" }, "x"])).toEqual([{ id: "a", presence: "asleep" }]);
    expect(blockedNotice({ presence: "jacked_in" }, "Aeland")).toBe("Aeland is jacked in");
    expect(blockedNotice({ presence: "asleep" }, "Natasha")).toBe("Natasha is asleep");
  });

  it("follows next_speaker from done and sends if_rev from the LATEST done.scene", () => {
    const frames = F.sse.user_turn_two_speakers;
    const plan = scenePlanFromFrame(frames[0].scene_plan);
    const done = frames[frames.length - 1];
    const follow = nextPlanFollow(done, null, plan);
    expect(follow).toEqual({ planId: "plan_1", index: 1, speakerId: "c_ser" });
    // The plan was issued at rev 4; the plan's own marker bumped it to 5.
    expect(planRequestFields(follow, normalizeScene(done.scene).rev)).toEqual({ if_rev: 5, scene_plan_id: "plan_1", responder_index: 1 });
  });

  it("a skipped speaker ends the loop when the server says next_speaker: null", () => {
    const frames = F.sse.follow_up_skipped_speaker;
    const done = frames[frames.length - 1];
    expect(nextPlanFollow(done, { planId: "plan_1", index: 1 })).toBeNull();
    expect(blockedFromServer(done.blocked)).toEqual([{ id: "c_scarlet", presence: "away" }]);
  });

  it("prefers the server's responder_index / plan.index over counting", () => {
    expect(nextPlanFollow({ next_speaker: { character_id: "x", responder_index: 3 } }, { planId: "p", index: 0 })).toEqual({ planId: "p", index: 3, speakerId: "x" });
    expect(nextPlanFollow({ next_speaker: { character_id: "x" }, scene: { plan: { id: "p9", index: 2 } } }, null)).toEqual({ planId: "p9", index: 2, speakerId: "x" });
  });

  it("first request carries only if_rev; no rev means no field", () => {
    expect(planRequestFields(null, 4)).toEqual({ if_rev: 4 });
    expect(planRequestFields(null, null)).toEqual({});
  });
});

describe("/scene command detection", () => {
  it("intercepts /scene only", () => {
    expect(isSceneCommand("/scene Rooftop, Natasha")).toBe(true);
    expect(isSceneCommand("  /SCENE , Natasha")).toBe(true);
    expect(isSceneCommand("/scene")).toBe(true);
    expect(isSceneCommand("/scenery is nice")).toBe(false);
    expect(isSceneCommand("let's set the /scene")).toBe(false);
  });
});
