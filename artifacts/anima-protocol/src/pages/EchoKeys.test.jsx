import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const meMock = vi.hoisted(() => vi.fn());
const updateMeMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/base44Client", () => ({
  base44: {
    auth: {
      me: meMock,
      updateMe: updateMeMock,
    },
  },
}));

vi.mock("@/lib/usePageMeta", () => ({
  usePageMeta: () => {},
  ROUTE_META: { "/echo-keys": {} },
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

import EchoKeys from "./EchoKeys";

describe("EchoKeys page", () => {
  beforeEach(() => {
    meMock.mockResolvedValue({ echo_keys: null });
    updateMeMock.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens story mode with a starter Vault, not the full Codex", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <EchoKeys />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/8 in Vault/i);
    expect(container.textContent).toMatch(/Codex of 800/i);
    expect(container.textContent).toMatch(/Echo Keys/i);
    expect(container.textContent).toMatch(/Story/i);
    expect(container.textContent).toMatch(/Resonance sites/i);
    expect(container.textContent).not.toMatch(/800 weapon-memories/i);
  });

  it("attunes a site and lists Vault / Loadout / Codex", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <EchoKeys />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const ruin = Array.from(container.querySelectorAll("button")).find((el) =>
      /Ruins of a Civilization/i.test(el.textContent || ""),
    );
    expect(ruin).toBeTruthy();
    await act(async () => {
      ruin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const attune = Array.from(container.querySelectorAll("button")).find((el) =>
      /Virtual attune/i.test(el.textContent || ""),
    );
    expect(attune).toBeTruthy();
    await act(async () => {
      attune.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/Synchronized/i);
    expect(updateMeMock).toHaveBeenCalled();

    for (const label of ["Vault", "Loadout", "Codex"]) {
      const tab = Array.from(container.querySelectorAll("button")).find((el) =>
        el.textContent.trim() === label,
      );
      expect(tab, label).toBeTruthy();
      await act(async () => {
        tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(container.textContent).toMatch(/Unattuned|Codex lists|known/i);
  });
});
