import { describe, expect, it } from "vitest";
import {activeExtrasKey, applyActiveExtras, readActiveExtras, saveActiveExtras} from "./experienceRuntime";

function storage() {
  const rows = new Map();
  return {
    getItem: key => rows.get(key) || null,
    setItem: (key,val) => rows.set(key,val),
  };
}
describe("Experience runtime isolation", () => {
  it("keeps applied extras separate across signed-in users", () => {
    const s = storage();
    const key = activeExtrasKey("alice");
    expect(key).not.toEqual(activeExtrasKey("bob"));
    s.setItem(key,JSON.stringify({bubble:"terminal",character:"hologram",role:"owner",memory:"secret"}));
    expect(readActiveExtras("alice",s).bubble).toBe("terminal");
    expect(readActiveExtras("bob",s).bubble).toBe("standard");
    expect(readActiveExtras(null,s).bubble).toBe("standard");
  });
  it("applies only allowlisted data attributes and resets on sign out", () => {
    const s = storage();
    s.setItem(activeExtrasKey("alice"),JSON.stringify({bubble:"rounded",navigation:"command",allowMultipleAnima:true}));
    const root = { dataset: {} };
    applyActiveExtras("alice",{documentElement:root},s);
    expect(root.dataset.experienceBubble).toBe("rounded");
    expect(root.dataset.experienceNavigation).toBe("command");
    expect(root.dataset.experienceAllowMultipleAnima).toBeUndefined();
    applyActiveExtras(null,{documentElement:root},s);
    expect(root.dataset.experienceBubble).toBe("standard");
    expect(root.dataset.experienceNavigation).toBe("tabs");
  });
  it("refuses writes without authentication", () => {
    expect(() => saveActiveExtras(null,{bubble:"rounded"},storage())).toThrow(/Sign in/);
  });
});