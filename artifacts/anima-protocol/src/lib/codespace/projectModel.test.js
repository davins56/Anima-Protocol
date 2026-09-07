import { describe, expect, it } from "vitest";
import {
  CODESPACE_PROJECT_NAMES,
  emptyRepoProject,
  pickCodespaceProject,
} from "./projectModel.js";

describe("pickCodespaceProject", () => {
  const virtual = { id: "v", name: CODESPACE_PROJECT_NAMES.virtual, files: [] };
  const repo = { id: "r", name: CODESPACE_PROJECT_NAMES.repo, files: [] };

  it("picks the named virtual project, else the first row", () => {
    expect(pickCodespaceProject([repo, virtual], { isRepoMode: false })).toEqual(virtual);
    expect(pickCodespaceProject([{ id: "legacy" }], { isRepoMode: false })).toEqual({ id: "legacy" });
  });

  it("picks only the repo project in repo mode", () => {
    expect(pickCodespaceProject([virtual, repo], { isRepoMode: true })).toEqual(repo);
    expect(pickCodespaceProject([virtual], { isRepoMode: true })).toBeNull();
    expect(emptyRepoProject().files).toEqual([]);
    expect(emptyRepoProject().name).toBe(CODESPACE_PROJECT_NAMES.repo);
  });
});
