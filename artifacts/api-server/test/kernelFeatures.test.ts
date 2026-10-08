import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLOUDFLARE_RUNTIME_ENV_NAMES,
  bindRequestEnv,
  mirrorCloudflareBindings,
  resetCloudflareEnvBindingsForTests,
} from "../src/lib/cloudflareEnv";
import {
  KERNEL_FEATURE_ENV,
  type KernelFeature,
  isKernelFeatureEnabled,
  kernelFeatureFlags,
} from "../src/lib/kernelFeatures";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const FEATURES = Object.keys(KERNEL_FEATURE_ENV) as KernelFeature[];
const ENV_NAMES = Object.values(KERNEL_FEATURE_ENV);

beforeEach(() => {
  for (const name of ENV_NAMES) delete process.env[name];
});

afterEach(() => {
  resetCloudflareEnvBindingsForTests();
  for (const name of ENV_NAMES) delete process.env[name];
});

describe("kernel feature switches", () => {
  it("defaults every roadmap piece to off", () => {
    expect(kernelFeatureFlags({})).toEqual({
      self_model: false,
      relationship_model: false,
      reflection: false,
      drive: false,
      agency: false,
      kernel: false,
    });
    for (const feature of FEATURES) {
      expect(isKernelFeatureEnabled(feature)).toBe(false);
      expect(isKernelFeatureEnabled(feature, {})).toBe(false);
    }
  });

  it("turns a piece on only for 1, true, yes, or on", () => {
    for (const on of ["1", "true", "TRUE", " yes ", "on", "On", "true\n", "true "]) {
      expect(isKernelFeatureEnabled("self_model", { ANIMA_KERNEL_SELF_MODEL: on })).toBe(
        true,
      );
    }
  });

  it("treats unknown and malformed values as off", () => {
    const malformed = [
      "",
      " ",
      "false",
      "0",
      "off",
      "no",
      "2",
      "enabled",
      "yes please",
      "truee",
      '"true"',
      "null",
      "undefined",
    ];
    for (const value of malformed) {
      expect(
        isKernelFeatureEnabled("drive", { ANIMA_KERNEL_DRIVE: value }),
        value,
      ).toBe(false);
    }
    expect(isKernelFeatureEnabled("drive", { ANIMA_KERNEL_DRIVE: true })).toBe(false);
    expect(isKernelFeatureEnabled("drive", { ANIMA_KERNEL_DRIVE: 1 })).toBe(false);
    expect(isKernelFeatureEnabled("drive", { ANIMA_KERNEL_DRIVE: { value: "true" } })).toBe(
      false,
    );
    expect(isKernelFeatureEnabled("not_a_feature", { ANIMA_KERNEL_DRIVE: "true" })).toBe(
      false,
    );
    expect(isKernelFeatureEnabled("", { ANIMA_KERNEL_ORCHESTRATOR: "true" })).toBe(false);
    expect(isKernelFeatureEnabled("self-model", { ANIMA_KERNEL_SELF_MODEL: "true" })).toBe(
      false,
    );
  });

  it("enables one piece without enabling the others", () => {
    const env = { ANIMA_KERNEL_REFLECTION: "true" };
    expect(kernelFeatureFlags(env)).toEqual({
      self_model: false,
      relationship_model: false,
      reflection: true,
      drive: false,
      agency: false,
      kernel: false,
    });
  });

  it("reads a non-enumerable Worker secret at request time", () => {
    const binding: Record<string, unknown> = {};
    Object.defineProperty(binding, "ANIMA_KERNEL_AGENCY", {
      value: "true",
      enumerable: false,
    });
    Object.defineProperty(binding, "ANIMA_KERNEL_DRIVE", {
      value: "maybe",
      enumerable: false,
    });
    bindRequestEnv(binding);
    expect(isKernelFeatureEnabled("agency")).toBe(true);
    expect(isKernelFeatureEnabled("drive")).toBe(false);
    expect(isKernelFeatureEnabled("kernel")).toBe(false);
  });

  it("is mirrored from a non-enumerable Worker binding", () => {
    for (const name of ENV_NAMES) {
      expect(CLOUDFLARE_RUNTIME_ENV_NAMES).toContain(name);
    }
    const env: Record<string, unknown> = {};
    Object.defineProperty(env, "ANIMA_KERNEL_ORCHESTRATOR", {
      value: " yes ",
      enumerable: false,
    });
    const target: Record<string, string | undefined> = {};
    mirrorCloudflareBindings(env, target);
    expect(target.ANIMA_KERNEL_ORCHESTRATOR).toBe("yes");
    expect(isKernelFeatureEnabled("kernel", target)).toBe(true);
  });

  it("names every switch in the kernel doc", () => {
    const doc = readFileSync(
      path.join(repoRoot, "artifacts/anima-protocol/docs/ANIMA_KERNEL.md"),
      "utf8",
    );
    expect(doc).toContain("isKernelFeatureEnabled");
    for (const feature of FEATURES) expect(doc).toContain(feature);
    for (const name of ENV_NAMES) expect(doc).toContain(name);
  });
});
