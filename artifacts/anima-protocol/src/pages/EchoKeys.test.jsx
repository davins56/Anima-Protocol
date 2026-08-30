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

import EchoKeys from "./EchoKeys";

describe("EchoKeys page", () => {
  beforeEach(() => {
    meMock.mockResolvedValue({ echo_keys: null });
    updateMeMock.mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the 800-key profile library", async () => {
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
    expect(container.textContent).toMatch(/800 weapon-memories/i);
    expect(container.textContent).toMatch(/Echo Keys/i);
    expect(container.textContent).toMatch(/Folder/i);
  });
});
