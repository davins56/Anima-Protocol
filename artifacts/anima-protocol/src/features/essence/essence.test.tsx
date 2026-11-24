import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DreamJournalError } from "@/lib/dreamJournal";

const mocks = vi.hoisted(() => ({
  fetchDreamJournal: vi.fn(),
  health: null as null | { memory_count: number; first_memory_at: string | null },
}));

vi.mock("@/api/animaClient", () => ({
  animaClient: {
    entities: {
      Anima: { list: vi.fn().mockResolvedValue([{ id: "c1", name: "Serenity" }]) },
      Character: { list: vi.fn().mockResolvedValue([]) },
    },
  },
}));
vi.mock("@/lib/dreamJournal", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dreamJournal")>("@/lib/dreamJournal");
  return { ...actual, fetchDreamJournal: mocks.fetchDreamJournal };
});
vi.mock("@/hooks/useMemoryHealth", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useMemoryHealth")>("@/hooks/useMemoryHealth");
  return { ...actual, useMemoryHealth: () => mocks.health };
});
vi.mock("@/components/vessel/VesselPortrait", () => ({
  default: ({ fallback }: { fallback: React.ReactNode }) => <span data-testid="vessel-portrait">{fallback}</span>,
}));

import EssencePage from "./EssencePage";

function renderAt(path: string, enabled = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/essence/:characterId?/:screen?" element={<EssencePage enabled={enabled} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.health = { memory_count: 42, first_memory_at: "2026-10-01T00:00:00Z" };
  mocks.fetchDreamJournal.mockResolvedValue({
    character_id: "c1",
    dreaming_enabled: true,
    unread_count: 0,
    dreams: [{ id: "d1", created_at: "2026-11-22T00:00:00Z", mood: "dreamy", themes: ["lantern"], summary: "A hallway of lanterns.", fragment: "I kept walking.", read: false }],
    next_cursor: null,
  });
});
afterEach(() => cleanup());

describe("EssencePage", () => {
  it("renders nothing when the flag is off", () => {
    renderAt("/essence/c1/calibrate", false);
    expect(screen.getByTestId("essence-disabled")).toBeTruthy();
    expect(mocks.fetchDreamJournal).not.toHaveBeenCalled();
  });

  it("shows the five screens in the approved order", async () => {
    renderAt("/essence/c1/calibrate");
    const nav = await screen.findByRole("navigation", { name: "Essence screens" });
    expect(nav.textContent).toMatch(/Calibrate.*Vessel Awakens.*Aspects.*Reflections.*Patterns/);
  });

  it("Calibrate saves a non-humanoid form with a placeholder instead of rendering it", async () => {
    renderAt("/essence/c1/calibrate");
    expect(await screen.findByTestId("vessel-portrait")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Crystal/ }));
    expect(screen.getByTestId("essence-form-placeholder")).toBeTruthy();
    expect(screen.queryByTestId("vessel-portrait")).toBeNull();
    fireEvent.change(screen.getByLabelText("Sapphire resonance"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save calibration" }));
    expect(screen.getByRole("status").textContent).toMatch(/Saved on this device/);
    const stored = JSON.parse(localStorage.getItem("anima_essence_v1") || "{}");
    expect(stored.c1.profile.calibration.vesselType).toBe("crystal");
    expect(stored.c1.profile.calibration.resonance.intensity).toBe(90);
    expect(stored.c1.profile.calibration.source).toMatchObject({ vesselType: "user", "resonance.intensity": "user" });
  });

  it("Vessel Awakens shows real memory count and dream fragments", async () => {
    renderAt("/essence/c1/vessel");
    expect(await screen.findByText("I kept walking.")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("Aspects counts Memory and Dream from live routes and links them", async () => {
    renderAt("/essence/c1/aspects");
    await waitFor(() => expect(screen.getByTestId("aspect-count-dream").textContent).toBe("1"));
    expect(screen.getByTestId("aspect-count-memory").textContent).toBe("42");
    expect(screen.getByTestId("aspect-count-emotion").textContent).toBe("—");
    expect(screen.getByTestId("aspect-dream").getAttribute("href")).toBe("/dreams/c1");
    expect(screen.getByTestId("aspect-memory").getAttribute("href")).toBe("/what-she-remembers/c1");
  });

  it("Dream falls back to a pending state when the journal route is unavailable", async () => {
    mocks.fetchDreamJournal.mockRejectedValue(new DreamJournalError("unavailable", 404));
    renderAt("/essence/c1/patterns");
    expect(await screen.findByTestId("essence-patterns-dreams-pending")).toBeTruthy();
  });

  it("never marks dreams read from Essence", async () => {
    renderAt("/essence/c1/vessel");
    await screen.findByText("I kept walking.");
    expect(localStorage.getItem("anima_dream_journal_read")).toBeNull();
  });

  it("Reflections keeps entries on device and says so", async () => {
    renderAt("/essence/c1/reflections");
    expect(await screen.findByTestId("essence-reflections-empty")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reflection"), { target: { value: "She lit up today." } });
    fireEvent.click(screen.getByRole("button", { name: "Keep reflection" }));
    expect(screen.getByText("She lit up today.")).toBeTruthy();
    expect(screen.getByTestId("essence-reflections-local").textContent).toMatch(/device only/);
  });

  it("Patterns tallies dream moods and themes", async () => {
    renderAt("/essence/c1/patterns");
    expect(await screen.findByTestId("essence-moods")).toBeTruthy();
    expect(screen.getByTestId("essence-themes").textContent).toMatch(/lantern/);
  });
});

describe("Calibrate name rules", () => {
  it("rejects a name over 60 characters with a clear message", async () => {
    renderAt("/essence/c1/calibrate");
    await screen.findByTestId("vessel-portrait");
    const input = screen.getAllByRole("textbox")[0];
    input.removeAttribute("maxlength");
    fireEvent.change(input, { target: { value: "x".repeat(61) } });
    fireEvent.click(screen.getByRole("button", { name: "Save calibration" }));
    expect(screen.getByRole("alert").textContent).toMatch(/1–60 characters/);
    expect(localStorage.getItem("anima_essence_v1")).toBeNull();
  });
});
