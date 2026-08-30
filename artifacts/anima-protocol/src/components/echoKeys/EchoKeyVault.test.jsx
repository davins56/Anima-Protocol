import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EchoKeyVault from "./EchoKeyVault";
import { defaultEchoLibrary, ECHO_KEYS } from "@/lib/echoKeys";

afterEach(cleanup);

describe("EchoKeyVault", () => {
  it(
    "lists the Codex and finds Star Force memories without granting them all",
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
      expect(screen.getByText(/11 on this profile/i)).toBeTruthy();
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
    },
    15_000,
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
    15_000,
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
    15_000,
  );
});
