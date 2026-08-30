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

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { settings: {} }, setUser: vi.fn() }),
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

import EchoKeys from "./EchoKeys";

describe("EchoKeys page", () => {
  beforeEach(() => {
    meMock.mockResolvedValue({ settings: {} });
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
    expect(container.textContent).toMatch(/in Vault/i);
    expect(container.textContent).toMatch(/Echo Keys/i);
    expect(container.textContent).toMatch(/Story/i);
    expect(container.textContent).toMatch(/Resonance sites/i);
    expect(container.textContent).not.toMatch(/This profile holds the full library/i);
  });

  it("filters the Codex by Echo Shard, Echo Key, Sovereign Key, and Prime Key", async () => {
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
    const codexTab = [...container.querySelectorAll("button")].find((b) => /^codex$/i.test(b.textContent || ""));
    expect(codexTab).toBeTruthy();
    await act(async () => {
      codexTab.click();
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/Echo Shard/i);
    expect(container.textContent).toMatch(/Sovereign Key/i);
    expect(container.textContent).toMatch(/Prime Key/i);
    const shardTab = [...container.querySelectorAll("button")].find((b) => /^echo shard$/i.test(b.textContent || ""));
    await act(async () => {
      shardTab.click();
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/Beth \/ Home/);
  });
});
