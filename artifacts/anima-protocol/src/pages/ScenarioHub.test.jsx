import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScenarioHub from "./ScenarioHub";

/**
 * The hub is the only way to reach saved what-if scenarios, so it must render
 * them, and say so plainly when there are none. Clerk is stubbed because the
 * page only reads the signed-in identity for its "Mine" filter.
 */
vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: { id: "user_1", primaryEmailAddress: { emailAddress: "a@b.c" } } }),
}));

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function renderHub(loadScenarios) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ScenarioHub loadScenarios={loadScenarios} />
      </MemoryRouter>,
    );
  });
}

describe("ScenarioHub", () => {
  it("lists every saved what-if scenario", async () => {
    await renderHub(async () => [
      { id: "s1", title: "The Rebel Path", description: "What if she refused the crown" },
      { id: "s2", title: "Peace Treaty", description: "What if the war never started" },
    ]);

    expect(container.textContent).toContain("Scenario Hub");
    expect(container.textContent).toContain("The Rebel Path");
    expect(container.textContent).toContain("Peace Treaty");
    expect(container.textContent).toContain("2 scenarios");
  });

  it("offers to create the first scenario when the hub is empty", async () => {
    await renderHub(async () => []);

    expect(container.textContent).toContain("No what-if scenarios yet");
    expect(container.textContent).toContain("Create the first scenario");
  });

  it("filters by search text", async () => {
    await renderHub(async () => [
      { id: "s1", title: "The Rebel Path", description: "" },
      { id: "s2", title: "Peace Treaty", description: "" },
    ]);

    const input = container.querySelector('input[aria-label="Search scenarios"]');
    // React tracks the DOM value, so set it through the native setter before
    // dispatching input; assigning `.value` alone is swallowed by the tracker.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    await act(async () => {
      setValue.call(input, "rebel");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("The Rebel Path");
    expect(container.textContent).not.toContain("Peace Treaty");
  });

  it("reports a load failure instead of pretending the hub is empty", async () => {
    await renderHub(async () => {
      throw new Error("network down");
    });

    expect(container.textContent).toContain("network down");
  });
});
