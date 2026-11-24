import { describe, expect, it } from "vitest";
import { streamChatReply } from "./streamChatReply";
import { stripStageMarkers, stripStageMarkersStreaming } from "./machineTags";
import { mergeSceneEventRows, sceneEventRow } from "./situationalScene";
import { sceneFixtures, sseFrames } from "./situationalScene.fixtures";

const F = sceneFixtures();

function collect(frames, extra = {}) {
  const order = [];
  const deltas = [];
  const scene = [];
  const promise = streamChatReply(sseFrames(frames), {
    onDelta: (t) => {
      deltas.push(t);
      order.push("content");
    },
    onScene: (frame) => {
      scene.push(frame);
      order.push(frame.scene_plan ? "scene_plan" : "scene_event");
    },
    stripStage: true,
    ...extra,
  });
  return { promise, order, deltas, scene };
}

describe("SSE ordering and dedupe (#763 M1)", () => {
  it("scene_plan arrives before the first content; scene_event frames are delivered in order", async () => {
    const { promise, order, scene } = collect(F.sse.user_turn_two_speakers);
    const result = await promise;
    expect(order[0]).toBe("scene_plan");
    expect(order.indexOf("scene_plan")).toBeLessThan(order.indexOf("content"));
    expect(scene.filter((f) => f.scene_event)).toHaveLength(2);
    expect(result.next_speaker).toEqual({ character_id: "c_ser" });
    expect(result.scene.rev).toBe(5);
  });

  it("a duplicated scene_event frame becomes one thread row", async () => {
    const { promise, scene } = collect(F.sse.user_turn_two_speakers);
    await promise;
    let thread = [];
    for (const f of scene) if (f.scene_event) thread = mergeSceneEventRows(thread, [sceneEventRow(f.scene_event)]);
    expect(thread.map((r) => r.id)).toEqual(["m_evt_1"]);
  });
});

describe("stage markers are never painted (#763 M9)", () => {
  it("hides a marker split across chunks in every delta, and stream == stored text", async () => {
    const { promise, deltas } = collect(F.sse.user_turn_two_speakers);
    const result = await promise;
    for (const d of deltas) expect(d).not.toMatch(/\[\[|\]\]/);
    expect(result.content).toBe("Still up. I'll check on her");
    expect(deltas[deltas.length - 1]).toBe(result.content);
  });

  it("strips when done.visible still carried the marker", async () => {
    const frames = [{ content: "Bye. [[exit]]" }, { done: true, visible: "Bye. [[exit]]" }];
    const { promise } = collect(frames);
    expect((await promise).content).toBe("Bye.");
  });

  it("chunk-safe for every split point", () => {
    const text = "Hello [[enter:Serenity]] there [[exit]]";
    const final = stripStageMarkers(text);
    expect(final).toBe("Hello there");
    for (let i = 1; i < text.length; i += 1) {
      const view = stripStageMarkersStreaming(text.slice(0, i));
      expect(view).not.toMatch(/\[\[/);
      expect(final.startsWith(view.trimEnd()) || view.trimEnd() === "").toBe(true);
    }
  });

  it("leaves [EMOTION: …], single brackets, emoji and unclosed fragments alone", () => {
    expect(stripStageMarkers("I'm [EMOTION: tender] here 💜 [sic]")).toBe("I'm [EMOTION: tender] here 💜 [sic]");
    expect(stripStageMarkers("open [[never closes")).toBe("open [[never closes");
  });
});

describe("zero-speaker turns (#763 B8)", () => {
  it("narrated: resolves without an error and hands over the narration row", async () => {
    const { promise, scene } = collect(F.sse.zero_speakers_narrated);
    const result = await promise;
    expect(result.scene_no_reply).toBe(true);
    expect(result.content).toBe("");
    expect(scene.find((f) => f.scene_event).scene_event.metadata.kind).toBe("narration");
  });

  it("quiet: resolves without an error", async () => {
    const { promise } = collect(F.sse.zero_speakers_quiet);
    await expect(promise).resolves.toMatchObject({ scene_no_reply: true, content: "" });
  });

  it("flag off (no onScene): the same frames are ignored and an empty turn still fails loudly", async () => {
    await expect(streamChatReply(sseFrames(F.sse.zero_speakers_quiet))).rejects.toMatchObject({ code: "empty_reply" });
  });
});

describe("marker-only (event-only) turns", () => {
  const markerOnly = [
    {
      scene_plan: {
        id: "plan_exit",
        speakers: [{ character_id: "c_scarlet", reason: "forced" }],
        blocked: [],
        narrate: false,
        mode: "natural",
      },
    },
    { content: "[[exit]]" },
    { scene_event: F.rows.event_exit },
    { done: true, visible: "", assistant_character_id: "c_scarlet", next_speaker: null },
  ];

  it("resolves as a valid event-only turn instead of empty_reply", async () => {
    const { promise, scene } = collect(markerOnly);
    const result = await promise;
    expect(result.scene_event_only).toBe(true);
    expect(result.scene_no_reply).toBeFalsy();
    expect(result.content).toBe("");
    expect(result.assistant_character_id).toBe("c_scarlet");
    expect(scene.filter((f) => f.scene_event)).toHaveLength(1);
  });

  it("flag off (no onScene): markers stay in the reply, like today", async () => {
    const result = await streamChatReply(sseFrames(markerOnly));
    expect(result.content).toContain("[[exit]]");
    expect(result.scene_event_only).toBeUndefined();
  });

  it("rejected markers: a successful empty done with no scene_event is a quiet no-op", async () => {
    // e.g. a speaker who is not allowed to [[exit]]: the server still
    // returns 200 / done.visible "" and no event row. No toast, no bubble.
    const frames = [
      {
        scene_plan: {
          id: "plan_x",
          speakers: [{ character_id: "c_nat" }],
          blocked: [],
          narrate: false,
          mode: "natural",
        },
      },
      { content: "[[exit]]" },
      { done: true, visible: "", assistant_character_id: "c_nat" },
    ];
    const { promise, scene } = collect(frames);
    const result = await promise;
    expect(result.scene_quiet_noop).toBe(true);
    expect(result.scene_event_only).toBeFalsy();
    expect(result.scene_no_reply).toBeFalsy();
    expect(result.content).toBe("");
    expect(result.assistant_character_id).toBe("c_nat");
    expect(scene.filter((f) => f.scene_event)).toHaveLength(0);
  });

  it("honours done.scene_event_only as a no-assistant turn even without a scene_event frame", async () => {
    const frames = [
      { scene_plan: { id: "plan_y", speakers: [{ character_id: "c_ser" }], blocked: [], narrate: false, mode: "natural" } },
      { done: true, visible: "", assistant_character_id: "c_ser", scene_event_only: true },
    ];
    const result = await collect(frames).promise;
    expect(result).toMatchObject({ content: "", scene_event_only: true });
    expect(result.scene_quiet_noop).toBeFalsy();
  });

  it("only an explicit empty_reply error code fails the turn", async () => {
    const frames = [
      { scene_plan: { id: "plan_z", speakers: [{ character_id: "c_nat" }], blocked: [], narrate: false, mode: "natural" } },
      { error: "The companion returned an empty reply. Please try again.", code: "empty_reply", turn_id: "turn_z" },
    ];
    await expect(collect(frames).promise).rejects.toMatchObject({ code: "empty_reply", turnId: "turn_z" });
  });

  it("a stream that closes with no done and no events is still empty_reply", async () => {
    const frames = [
      { scene_plan: { id: "plan_z", speakers: [{ character_id: "c_nat" }], blocked: [], narrate: false, mode: "natural" } },
    ];
    await expect(collect(frames).promise).rejects.toMatchObject({ code: "empty_reply" });
  });
});

describe("flag-off parity", () => {
  it("without scene hooks a reply with markers streams exactly as before", async () => {
    const frames = [{ content: "Hi [[exit]]" }, { done: true, visible: "Hi [[exit]]" }];
    const result = await streamChatReply(sseFrames(frames));
    expect(result.content).toBe("Hi [[exit]]");
  });
});
