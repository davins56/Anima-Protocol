import { describe, expect, it, vi } from "vitest";
import { createCompanionRecord, seedStarterMemory } from "./createCompanion";

describe("starter memory seed on companion create", () => {
  it("seeds backstory + first facts after a successful create", async () => {
    const seed = vi.fn().mockResolvedValue({ added: 3 });
    const create = vi.fn().mockResolvedValue({ id: "a1", name: "Aeland", backstory: "She grew from an oak." });
    await createCompanionRecord("Anima", { name: "Aeland", personality: "Patient.", avatar_url: "" }, { create, seedMemory: seed });
    await vi.waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
    expect(seed).toHaveBeenCalledWith("a1", { name: "Aeland", backstory: "She grew from an oak.", personality: "Patient." });
  });
  it("a failing seed never fails the create", async () => {
    const seed = vi.fn().mockRejectedValue(new Error("offline"));
    const create = vi.fn().mockResolvedValue({ id: "a2", name: "Scarlet" });
    await expect(createCompanionRecord("Anima", { name: "Scarlet" }, { create, seedMemory: seed })).resolves.toMatchObject({ id: "a2" });
    expect(await seedStarterMemory({ id: "a2" }, {}, seed)).toBeNull();
  });
  it("seedMemory:false skips it; rows without id are ignored", async () => {
    const create = vi.fn().mockResolvedValue({ id: "a3", name: "X" });
    await createCompanionRecord("Anima", { name: "X" }, { create, seedMemory: false });
    expect(await seedStarterMemory({}, {}, vi.fn())).toBeNull();
  });
});
