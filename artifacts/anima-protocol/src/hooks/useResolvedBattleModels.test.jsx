import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import useResolvedBattleModels from "@/hooks/useResolvedBattleModels";
import { animaApi } from "@/api/animaApi";

vi.mock("@/api/animaApi", () => ({
  animaApi: {
    battleModels: {
      resolve: vi.fn(async () => ({
        renderer: "r3f-procedural",
        player: {
          role: "player",
          id: "serenity",
          name: "Remote Serenity",
          silhouette: "serenity",
          color: "#67e8f9",
          accent: "#fde68a",
          texture_url: null,
          glb_url: null,
          renderer: "r3f-procedural",
        },
        enemy: {
          role: "enemy",
          id: "shade",
          name: "Shade.Vrs",
          silhouette: "shade",
          color: "#fb7185",
          accent: "#fda4af",
          texture_url: null,
          glb_url: null,
          renderer: "r3f-procedural",
        },
      })),
    },
  },
}));

function renderHook(useHookFn) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: undefined };

  function Host() {
    result.current = useHookFn();
    return null;
  }

  act(() => {
    root.render(<Host />);
  });

  return {
    result,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useResolvedBattleModels", () => {
  it("returns a local Serenity + virus catalog immediately", () => {
    const { result, unmount } = renderHook(() =>
      useResolvedBattleModels(
        { name: "Serenity", color: "#67e8f9" },
        { name: "Shade.Vrs", color: "#fb7185" },
      ),
    );
    expect(result.current.player.silhouette).toBe("serenity");
    expect(result.current.enemy.silhouette).toBe("shade");
    unmount();
  });

  it("calls the battle-models resolve connection", async () => {
    animaApi.battleModels.resolve.mockClear();
    const { unmount } = renderHook(() =>
      useResolvedBattleModels(
        { name: "Serenity", color: "#67e8f9" },
        { name: "Shade.Vrs", color: "#fb7185" },
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(animaApi.battleModels.resolve).toHaveBeenCalled();
    unmount();
  });
});
