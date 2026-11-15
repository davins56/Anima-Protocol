import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animaApi, chatHttpError } from "./animaApi.js";
import { isScenePlanStaleError, isScenesDisabledError, sceneFromErrorPayload } from "@/lib/situationalScene";
import { sceneFixtures } from "@/lib/situationalScene.fixtures";

const F = sceneFixtures();
const authHeaders = vi.fn();
const fetchMock = vi.fn();

vi.mock("./authBridge", () => ({ authHeaders: (...args) => authHeaders(...args) }));
vi.mock("@/lib/apiOrigin", () => ({ apiUrl: (path) => `https://example.test/api${path}` }));

function jsonResponse(status, body) {
  return { ok: status < 400, status, statusText: "x", json: async () => body };
}

async function drain(gen) {
  try {
    for await (const _ of gen) {
      // no frames
    }
  } catch {
    // body capture only
  }
}

describe("#763 scene API", () => {
  beforeEach(() => {
    authHeaders.mockReset().mockResolvedValue({ Authorization: "Bearer t", "Content-Type": "application/json" });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET / PATCH / command hit the agreed routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, F.http.patch_result));
    await animaApi.chat.scene.get("s 1");
    await animaApi.chat.scene.patch("s 1", { mode: "everyone", if_rev: 4 });
    await animaApi.chat.scene.command("s 1", "/scene Rooftop, Natasha", 4);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/chat/sessions/s%201/scene");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ mode: "everyone", if_rev: 4 }) });
    expect(fetchMock.mock.calls[2][0]).toBe("https://example.test/api/chat/sessions/s%201/scene/command");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ text: "/scene Rooftop, Natasha", if_rev: 4 });
  });

  it("errors keep status and the 409 body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, F.http.scenes_disabled.body));
    const err = await animaApi.chat.scene.get("s1").catch((e) => e);
    expect(isScenesDisabledError(err)).toBe(true);
  });

  it("a 409 scene_plan_stale from POST /messages is recognized and carries { scene }", () => {
    const err = chatHttpError(F.http.scene_plan_stale.body, 409);
    expect(isScenePlanStaleError(err)).toBe(true);
    expect(sceneFromErrorPayload(err).rev).toBe(7);
  });

  it("flag-off parity: the /messages body has no scene keys unless the caller passes them", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "stop" }));
    const base = { sessionId: "s1", content: "hi", characterIds: ["a"], turnId: "t1" };
    await drain(animaApi.chat.sendMessage(base));
    const off = JSON.parse(fetchMock.mock.calls[0][1].body);
    for (const key of ["scene", "scene_plan_id", "responder_index", "if_rev"]) expect(off).not.toHaveProperty(key);

    await drain(animaApi.chat.sendMessage({ ...base, forceCharacterId: "c_ser", scene: { if_rev: 5, scene_plan_id: "plan_1", responder_index: 1 } }));
    const on = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(on).toMatchObject({ if_rev: 5, scene_plan_id: "plan_1", responder_index: 1, force_character_id: "c_ser" });
    // Only the plan fields differ from the flag-off body.
    const { if_rev, scene_plan_id, responder_index, force_character_id, ...rest } = on;
    const { force_character_id: offForce, ...offRest } = off;
    expect(rest).toEqual(offRest);
    expect(offForce).toBeNull();
    expect([if_rev, scene_plan_id, responder_index, force_character_id]).toEqual([5, "plan_1", 1, "c_ser"]);
  });
});
