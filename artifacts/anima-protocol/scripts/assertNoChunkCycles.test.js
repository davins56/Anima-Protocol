import { describe, expect, it } from "vitest";
import { findCycles, staticImports } from "./assertNoChunkCycles.mjs";

describe("assertNoChunkCycles", () => {
  it("reads static chunk imports (not dynamic ones)", () => {
    const code = 'import{a as e}from"./rolldown-runtime-X.js";import{N as a}from"./vendor-three-Y.js";export{t}from"./re-Z.js";const l=()=>import("./Lazy-Q.js");';
    expect(staticImports(code).sort()).toEqual(["re-Z.js", "rolldown-runtime-X.js", "vendor-three-Y.js"]);
  });

  it("finds the vendor-three ⇄ VesselAura cycle that broke /cyberworld, and passes an acyclic graph", () => {
    const bad = { "vendor-three.js": ["VesselAura.js", "react.js"], "VesselAura.js": ["vendor-three.js"], "react.js": [] };
    expect(findCycles(bad)).toEqual([["vendor-three.js", "VesselAura.js", "vendor-three.js"]]);
    const good = { "vendor-three.js": ["vendor-r3f-runtime.js", "react.js"], "VesselAura.js": ["vendor-three.js"], "vendor-r3f-runtime.js": ["react.js"], "react.js": [] };
    expect(findCycles(good)).toEqual([]);
  });
});
