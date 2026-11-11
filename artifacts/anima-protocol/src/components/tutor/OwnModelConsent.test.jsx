import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/api/animaApi", () => ({ animaApi: { model: {} } }));

import OwnModelConsent from "./OwnModelConsent";

async function render(api) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<OwnModelConsent api={api} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("OwnModelConsent", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stays hidden while the model isn't learning from other people", async () => {
    await render({ config: vi.fn().mockResolvedValue({ learning_open: false, share_for_training: false }) });
    expect(document.body.textContent).toBe("");
  });

  it("lets someone opt in, and out again", async () => {
    const api = {
      config: vi.fn().mockResolvedValue({ learning_open: true, share_for_training: false }),
      setConsent: vi
        .fn()
        .mockResolvedValueOnce({ share_for_training: true })
        .mockResolvedValueOnce({ share_for_training: false }),
    };
    await render(api);
    const toggle = document.body.querySelector('button[role="switch"]');
    expect(document.body.textContent).toContain("The Protocol steward can read those lessons.");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(api.setConsent).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(api.setConsent).toHaveBeenLastCalledWith(false);
  });

  it("still offers opting out after learning from others is switched off", async () => {
    await render({ config: vi.fn().mockResolvedValue({ learning_open: false, share_for_training: true }) });
    expect(document.body.querySelector('button[role="switch"]').getAttribute("aria-checked")).toBe("true");
  });
});
