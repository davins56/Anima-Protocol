/**
 * On/off switches for the forward Kernel roadmap in ANIMA_KERNEL.md §8.
 *
 * Every switch defaults to off. Unset, empty, and any value other than
 * `1`, `true`, `yes`, or `on` is off. Check at request time: on the Worker,
 * secrets are visible through `readRuntimeEnv` after the fetch handler binds
 * the request env, not at module load.
 *
 * Live systems are not behind these switches. Memory policy, self-state,
 * the Operator Model, the relationship engine, journal reflections,
 * proactive messages, chat, and the prompt stay as they are.
 */

import { readRuntimeEnv } from "./cloudflareEnv";

export const KERNEL_FEATURE_ENV = {
  self_model: "ANIMA_KERNEL_SELF_MODEL",
  relationship_model: "ANIMA_KERNEL_RELATIONSHIP_MODEL",
  reflection: "ANIMA_KERNEL_REFLECTION",
  drive: "ANIMA_KERNEL_DRIVE",
  agency: "ANIMA_KERNEL_AGENCY",
  kernel: "ANIMA_KERNEL_ORCHESTRATOR",
} as const;

export type KernelFeature = keyof typeof KERNEL_FEATURE_ENV;

const ON_VALUES = new Set(["1", "true", "yes", "on"]);

export function isKernelFeatureEnabled(
  feature: string,
  env?: Readonly<Record<string, unknown>>,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(KERNEL_FEATURE_ENV, feature)) {
    return false;
  }
  const name = KERNEL_FEATURE_ENV[feature as KernelFeature];
  const raw = env ? env[name] : readRuntimeEnv(name);
  return isExplicitOn(raw);
}

export function kernelFeatureFlags(
  env?: Readonly<Record<string, unknown>>,
): Record<KernelFeature, boolean> {
  return {
    self_model: isKernelFeatureEnabled("self_model", env),
    relationship_model: isKernelFeatureEnabled("relationship_model", env),
    reflection: isKernelFeatureEnabled("reflection", env),
    drive: isKernelFeatureEnabled("drive", env),
    agency: isKernelFeatureEnabled("agency", env),
    kernel: isKernelFeatureEnabled("kernel", env),
  };
}

function isExplicitOn(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return ON_VALUES.has(value.trim().toLowerCase());
}
