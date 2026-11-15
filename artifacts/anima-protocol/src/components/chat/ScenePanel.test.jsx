import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ScenePanel from "./ScenePanel";
import { castRows, normalizeScene } from "@/lib/situationalScene";
import { sceneFixtures } from "@/lib/situationalScene.fixtures";

const F = sceneFixtures();
const roster = [
  { id: "c_nat", name: "Natasha" },
  { id: "c_ser", name: "Serenity" },
  { id: "c_aeland", name: "Aeland" },
  { id: "c_scarlet", name: "Scarlet" },
];

function panel(raw = F.scene.group_rooftop) {
  const scene = normalizeScene(raw);
  const rows = castRows(scene, { participantIds: roster.map((c) => c.id), roster });
  const onPatch = vi.fn();
  render(<ScenePanel scene={scene} rows={rows} onPatch={onPatch} />);
  return onPatch;
}

describe("ScenePanel (#763 B1–B3)", () => {
  it("shows location, glyphs, reach badge, note and summary", () => {
    panel();
    expect(screen.getByTestId("scene-location").textContent).toBe("📍 Rooftop");
    expect(screen.getByTestId("scene-summary").textContent).toBe("Rooftop · 2 here · 1 away · 1 asleep");
    const scarlet = screen.getByTestId("scene-chip-c_scarlet");
    expect(scarlet.dataset.presence).toBe("away");
    expect(scarlet.textContent).toContain("↗");
    expect(scarlet.textContent).toContain("☎");
    expect(scarlet.textContent).toContain("at the archive");
    expect(screen.getByTestId("scene-chip-c_aeland").textContent).toContain("☾");
  });

  it("chip menu: each action sends one PATCH", () => {
    const onPatch = panel();
    fireEvent.click(screen.getByTestId("scene-chip-c_aeland"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Bring in/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ cast: { c_aeland: { presence: "here" } } });

    fireEvent.click(screen.getByTestId("scene-chip-c_nat"));
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "getting coffee" } });
    fireEvent.click(screen.getByRole("menuitem", { name: /Send away/ }));
    expect(onPatch).toHaveBeenLastCalledWith({ cast: { c_nat: { presence: "away", note: "getting coffee" } } });

    fireEvent.click(screen.getByTestId("scene-chip-c_ser"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Reach: text" }));
    expect(onPatch).toHaveBeenLastCalledWith({ cast: { c_ser: { reach: "text" } } });

    for (const [name, presence] of [["Asleep", "asleep"], ["Busy", "busy"], ["Jacked in", "jacked_in"], ["Injured", "injured"]]) {
      fireEvent.click(screen.getByTestId("scene-chip-c_ser"));
      fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(name) }));
      expect(onPatch).toHaveBeenLastCalledWith({ cast: { c_ser: { presence } } });
    }
    expect(onPatch).toHaveBeenCalledTimes(7);
  });

  it("mode toggle and narrator toggle", () => {
    const onPatch = panel();
    fireEvent.click(screen.getByRole("radio", { name: "Everyone answers" }));
    expect(onPatch).toHaveBeenLastCalledWith({ mode: "everyone" });
    fireEvent.click(screen.getByRole("radio", { name: "Natural" }));
    expect(onPatch).toHaveBeenCalledTimes(1); // already natural
    fireEvent.click(screen.getByLabelText("Narrator"));
    expect(onPatch).toHaveBeenLastCalledWith({ narrator: true });
  });

  it("location edit sends PATCH {location}", () => {
    const onPatch = panel();
    fireEvent.click(screen.getByTestId("scene-location"));
    const input = screen.getByLabelText("Scene location");
    fireEvent.change(input, { target: { value: "Docks" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPatch).toHaveBeenCalledWith({ location: "Docks" });
  });

  it("adult-gated note follows the server flag only", () => {
    panel(F.scene.group_rooftop);
    expect(screen.queryByTestId("scene-adult-gated")).not.toBeNull();
  });

  it("no note when the server says false or sent nothing (never inferred from the cast)", () => {
    panel(F.scene.group_no_gate_field);
    expect(screen.queryByTestId("scene-adult-gated")).toBeNull();
  });
});
