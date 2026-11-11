import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let authUser = null;
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));

const statusMock = vi.fn();
vi.mock("@/api/animaApi", () => ({
  animaApi: { tutor: { status: (...args) => statusMock(...args) } },
}));

import { resetModelTutorCacheForTests, useModelTutor } from "./useModelTutor";

let seen = null;
function Probe() {
  seen = useModelTutor();
  return null;
}

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Probe />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return root;
}

describe("useModelTutor", () => {
  beforeEach(() => {
    resetModelTutorCacheForTests();
    statusMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("never asks the server for someone the app does not treat as an admin", async () => {
    authUser = { id: "u1", role: "User" };
    await mount();
    expect(statusMock).not.toHaveBeenCalled();
    expect(seen.isSteward).toBe(false);
  });

  it("asks once for an admin and trusts the server's answer", async () => {
    authUser = { id: "u2", role: "admin" };
    statusMock.mockResolvedValue({ isSteward: true, configured: true });
    await mount();
    await mount();
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(seen.isSteward).toBe(true);
  });

  it("treats a failed status call as not a steward", async () => {
    authUser = { id: "u3", role: "admin" };
    statusMock.mockRejectedValue(new Error("offline"));
    await mount();
    expect(seen.isSteward).toBe(false);
  });
});
