import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const confirmProtocolUpgrade = vi.fn();
const cancelProtocolUpgrade = vi.fn();
vi.mock("@/lib/serenityProtocolUpgrade", () => ({
  confirmProtocolUpgrade: (...args) => confirmProtocolUpgrade(...args),
  cancelProtocolUpgrade: (...args) => cancelProtocolUpgrade(...args),
  protocolUpgradeErrorMessage: () => "snagged",
}));

import ProtocolUpgradeConfirmCard from "./ProtocolUpgradeConfirmCard";

let container;
let root;

function render(payload) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ProtocolUpgradeConfirmCard payload={payload} />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});

const pending = {
  id: "up1",
  status: "awaiting_confirmation",
  scope: "interface",
  request: "Upgrade the interface to be darker.",
  expires_at: "2099-01-01T00:00:00.000Z",
};

function button(label) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.includes(label));
}

describe("ProtocolUpgradeConfirmCard", () => {
  it("does nothing until Confirm weave is pressed", async () => {
    confirmProtocolUpgrade.mockResolvedValue({ ...pending, status: "running", agent_url: "https://cursor.com/agents/bc" });
    render(pending);
    expect(confirmProtocolUpgrade).not.toHaveBeenCalled();
    await act(async () => {
      button("Confirm weave").click();
    });
    expect(confirmProtocolUpgrade).toHaveBeenCalledWith("up1", { surface: "chat" });
    expect(container.textContent).toMatch(/Weaving/);
    expect(button("Confirm weave")).toBeUndefined();
  });

  it("cancel never confirms", async () => {
    cancelProtocolUpgrade.mockResolvedValue({ ...pending, status: "cancelled" });
    render(pending);
    await act(async () => {
      button("Cancel").click();
    });
    expect(cancelProtocolUpgrade).toHaveBeenCalledWith("up1");
    expect(confirmProtocolUpgrade).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/Not started/);
  });

  it("hides the confirm button once the window has expired", () => {
    render({ ...pending, expires_at: "2000-01-01T00:00:00.000Z" });
    expect(button("Confirm weave")).toBeUndefined();
  });
});
