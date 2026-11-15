import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/api/animaApi", () => ({ animaApi: { chat: { scene: {} } } }));

import { useSituationalScene } from "./useSituationalScene";
import { httpFixtureError, sceneFixtures } from "@/lib/situationalScene.fixtures";

const F = sceneFixtures();

function setup(api, sid = "s_group") {
  const openSessionIdRef = { current: sid };
  const onEvents = vi.fn();
  const onNotice = vi.fn();
  const hook = renderHook(() => useSituationalScene({ openSessionIdRef, onEvents, onNotice, api }));
  return { hook, openSessionIdRef, onEvents, onNotice };
}

describe("useSituationalScene", () => {
  it("flag off in context: no GET, stays off", async () => {
    const api = { get: vi.fn() };
    const { hook } = setup(api);
    let on;
    await act(async () => {
      on = await hook.result.current.loadFromContext("s_group", F.context.flag_off);
    });
    expect(on).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
    expect(hook.result.current.enabled).toBe(false);
  });

  it("flag on: loads the scene; adult_gated comes from the server", async () => {
    const api = { get: vi.fn().mockResolvedValue(F.scene.group_rooftop) };
    const { hook } = setup(api);
    await act(async () => {
      await hook.result.current.loadFromContext("s_group", F.context.flag_on);
    });
    expect(hook.result.current.enabled).toBe(true);
    expect(hook.result.current.scene.rev).toBe(4);
    expect(hook.result.current.scene.adult_gated).toBe(true);
  });

  it.each([
    ["409 scenes_disabled", F.http.scenes_disabled],
    ["404 routes missing", F.http.routes_missing],
  ])("GET %s keeps every control hidden, quietly", async (_label, fixture) => {
    const api = { get: vi.fn().mockRejectedValue(httpFixtureError(fixture)) };
    const { hook, onNotice } = setup(api);
    await act(async () => {
      await hook.result.current.loadFromContext("s_group", F.context.flag_on);
    });
    expect(hook.result.current.enabled).toBe(false);
    expect(onNotice).not.toHaveBeenCalled();
  });

  async function enabled(apiExtra = {}) {
    const api = { get: vi.fn().mockResolvedValue(F.scene.group_rooftop), ...apiExtra };
    const ctx = setup(api);
    await act(async () => {
      await ctx.hook.result.current.loadFromContext("s_group", F.context.flag_on);
    });
    return { ...ctx, api };
  }

  it("PATCH sends if_rev, applies optimistically, reconciles with the server scene and inserts events", async () => {
    let resolvePatch;
    const patch = vi.fn(() => new Promise((r) => (resolvePatch = r)));
    const { hook, api, onEvents } = await enabled({ patch });
    let pending;
    act(() => {
      pending = hook.result.current.patch("s_group", { cast: { c_scarlet: { presence: "away", note: "at the archive" } } });
    });
    expect(api.patch).toHaveBeenCalledWith("s_group", { cast: { c_scarlet: { presence: "away", note: "at the archive" } }, if_rev: 4 });
    expect(hook.result.current.scene.cast.c_scarlet.presence).toBe("away");
    await act(async () => {
      resolvePatch(F.http.patch_result);
      await pending;
    });
    expect(hook.result.current.scene.rev).toBe(5);
    expect(onEvents).toHaveBeenCalledWith("s_group", [F.rows.event_exit]);
  });

  it("PATCH 409 scenes_disabled mid-session rolls back and hides the controls without an error", async () => {
    const { hook, onNotice } = await enabled({ patch: vi.fn().mockRejectedValue(httpFixtureError(F.http.scenes_disabled)) });
    await act(async () => {
      await hook.result.current.patch("s_group", { mode: "everyone" });
    });
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.scene).toBeNull();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it("PATCH scene_conflict adopts the server's current scene", async () => {
    const { hook, onNotice } = await enabled({ patch: vi.fn().mockRejectedValue(httpFixtureError(F.http.scene_conflict)) });
    await act(async () => {
      await hook.result.current.patch("s_group", { mode: "natural" });
    });
    expect(hook.result.current.scene.rev).toBe(9);
    expect(hook.result.current.scene.location).toBe("Docks");
    expect(onNotice).toHaveBeenCalledWith("conflict", expect.any(String));
  });

  it("PATCH failure rolls the optimistic change back", async () => {
    const { hook, onNotice } = await enabled({ patch: vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { status: 500 })) });
    await act(async () => {
      await hook.result.current.patch("s_group", { location: "Moon" });
    });
    expect(hook.result.current.scene.location).toBe("Rooftop");
    expect(onNotice).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("/scene command returns unresolved names and adopts the scene", async () => {
    const command = vi.fn().mockResolvedValue(F.http.command_result);
    const { hook } = await enabled({ command });
    let res;
    await act(async () => {
      res = await hook.result.current.command("s_group", "/scene Library, Natasha, Morpheus");
    });
    expect(command).toHaveBeenCalledWith("s_group", "/scene Library, Natasha, Morpheus", 4);
    expect(res).toEqual({ ok: true, unresolved: ["Morpheus"] });
    expect(hook.result.current.scene.location).toBe("Library");
    expect(hook.result.current.scene.adult_gated).toBe(false);
  });

  it("a result for a session that is no longer open is dropped (isolation)", async () => {
    let resolvePatch;
    const { hook, openSessionIdRef, onEvents } = await enabled({ patch: vi.fn(() => new Promise((r) => (resolvePatch = r))) });
    let pending;
    act(() => {
      pending = hook.result.current.patch("s_group", { location: "Docks" });
    });
    openSessionIdRef.current = "s_other";
    await act(async () => {
      resolvePatch(F.http.patch_result);
      await pending;
    });
    expect(onEvents).not.toHaveBeenCalled();
    expect(hook.result.current.adopt("s_group", F.http.patch_result)).toBeNull();
  });

  it("done.scene / stale payload adoption only while enabled", async () => {
    const { hook } = await enabled();
    act(() => {
      hook.result.current.adopt("s_group", F.http.scene_plan_stale.body.scene);
    });
    expect(hook.result.current.scene.rev).toBe(7);
    act(() => hook.result.current.reset("s_group"));
    expect(hook.result.current.adopt("s_group", F.scene.group_rooftop)).toBeNull();
  });
});
