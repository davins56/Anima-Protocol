import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EchoKeyVault from "./EchoKeyVault";
import { defaultEchoLibrary, ECHO_KEYS, ECHO_LIBRARY_GRID_CAP, tierOf } from "@/lib/echoKeys";

function echoCardButtons() {
  return screen.getAllByRole("button").filter((el) =>
    /^\d{3,4} ·/.test((el.textContent || "").replace(/\s+/g, " ").trim()),
  );
}

afterEach(cleanup);

describe("EchoKeyVault", () => {
  it(
    "lists the full Codex and finds Star Force memories without rendering every card",
    () => {
      render(
        <EchoKeyVault
          library={defaultEchoLibrary()}
          onSave={vi.fn()}
          saving={false}
          error={null}
          onReset={vi.fn()}
        />,
      );

      expect(screen.getByText(/on this profile/i)).toBeTruthy();
      expect(screen.getByText(new RegExp(`${ECHO_KEYS.length} on this profile`))).toBeTruthy();
      expect(echoCardButtons()).toHaveLength(ECHO_LIBRARY_GRID_CAP);
      expect(screen.getByRole("button", { name: /^echo shard$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^echo key$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^sovereign key$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^prime key$/i })).toBeTruthy();
      expect(screen.getAllByText("Pulse Emitter").length).toBeGreaterThan(0);

      fireEvent.change(screen.getByPlaceholderText(/search echo keys/i), {
        target: { value: "plasma" },
      });
      expect(screen.getByText(/10 listed/i)).toBeTruthy();
      expect(screen.getAllByText("Plasmagun").length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole("button", { name: /^echo shard$/i }));
      fireEvent.change(screen.getByPlaceholderText(/search echo keys/i), {
        target: { value: "Beth / Home" },
      });
      expect(screen.getAllByText("Beth / Home").length).toBeGreaterThan(0);
      fireEvent.click(screen.getAllByText("Beth / Home")[0]);
      expect(screen.getByText(/Presence without possession/i)).toBeTruthy();
      expect(screen.getByText(/B \*/i)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /^sovereign key$/i }));
      fireEvent.change(screen.getByPlaceholderText(/search echo keys/i), {
        target: { value: "" },
      });
      const sovereignCount = ECHO_KEYS.filter((k) => tierOf(k) === "sovereign").length;
      expect(screen.getByText(new RegExp(`${sovereignCount} listed`))).toBeTruthy();
      expect(echoCardButtons().length).toBe(sovereignCount);
      expect(echoCardButtons().length).toBeGreaterThan(0);
    },
    30_000,
  );

  it(
    "opens the 30-slot folder with Regular and Star-Force pins",
    () => {
      render(
        <EchoKeyVault
          library={defaultEchoLibrary()}
          onSave={vi.fn()}
          saving={false}
          error={null}
          onReset={vi.fn()}
        />,
      );

      expect(ECHO_KEYS.filter((k) => k.class === "star")).toHaveLength(80);
      fireEvent.click(screen.getByRole("button", { name: /^folder$/i }));
      expect(screen.getByText(/30\/30 slotted/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /save folder to profile/i })).toBeTruthy();
      expect(screen.getByText(/regular key/i)).toBeTruthy();
      expect(screen.getByText(/star-force pin/i)).toBeTruthy();
    },
    30_000,
  );

  it(
    "documents BN chip lineage and Star Force cards",
    () => {
      render(
        <EchoKeyVault
          library={defaultEchoLibrary()}
          onSave={vi.fn()}
          saving={false}
          error={null}
          onReset={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /chip \/ card account/i }));
      expect(screen.getByText(/Battle Chip lineage/i)).toBeTruthy();
      expect(screen.getByText(/Star Force cards/i)).toBeTruthy();
      expect(screen.getByText(/80 families/i)).toBeTruthy();
    },
    30_000,
  );
});
