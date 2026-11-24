/**
 * Chat upgrade 3: what this device can run, and which model to pick.
 * Pure picking logic (`pickOnDeviceModel`) is separate from the browser probe
 * (`probeDevice`) so it can be unit tested.
 */
import { modelById, type OnDeviceModel } from "./models";

export interface DeviceProfile {
  mobile: boolean;
  webgpu: boolean;
  /** WebGPU adapter supports `shader-f16` (needed for the q4f16 builds). */
  shaderF16: boolean;
  /** navigator.deviceMemory in GB when the browser reports it (Chromium only). */
  deviceMemoryGb: number | null;
  /** Largest single GPU buffer, a rough proxy for usable VRAM. */
  maxBufferMb: number | null;
  wasm: boolean;
}

export interface ModelPick {
  model: OnDeviceModel | null;
  /** Ordered: the pick first, then the local fallbacks to try if it fails to load. */
  candidates: OnDeviceModel[];
  reason: string;
}

const MB = 1024 * 1024;

function pickIds(p: DeviceProfile): { ids: string[]; reason: string } {
  const fallback = p.wasm ? ["wllama:qwen3-4b-q4km"] : [];
  if (!p.webgpu) {
    return {
      ids: fallback,
      reason: p.wasm ? "No WebGPU here, so the WebAssembly build (slower) is used." : "This browser can't run a local model.",
    };
  }
  const four = p.shaderF16 ? "webllm:qwen3-4b-q4f16" : "webllm:qwen3-4b-q4f32";
  const eight = p.shaderF16 ? "webllm:qwen3-8b-q4f16" : "webllm:qwen3-8b-q4f32";
  if (p.mobile) {
    return { ids: [four, ...fallback], reason: "Phone or tablet: Qwen3 4B." };
  }
  const memoryOk = p.deviceMemoryGb == null || p.deviceMemoryGb >= 8;
  const eightNeedMb = modelById(eight)?.approxMemoryMb ?? 6000;
  // maxBufferSize is per buffer, not total VRAM; only treat a small cap as a hard no.
  const bufferOk = p.maxBufferMb == null || p.maxBufferMb >= 1024;
  if (memoryOk && bufferOk) {
    return {
      ids: [eight, four, ...fallback],
      reason: `Desktop with WebGPU: Qwen3 8B (needs about ${Math.round(eightNeedMb / 1024)} GB of GPU memory), 4B if it won't load.`,
    };
  }
  return { ids: [four, ...fallback], reason: "Desktop with limited memory: Qwen3 4B." };
}

export function pickOnDeviceModel(profile: DeviceProfile, overrideId?: string | null): ModelPick {
  const { ids, reason } = pickIds(profile);
  const candidates = ids.map((id) => modelById(id)).filter((m): m is OnDeviceModel => Boolean(m));
  const override = modelById(overrideId);
  if (override && (override.engine === "wllama" ? profile.wasm : profile.webgpu)) {
    const rest = candidates.filter((m) => m.id !== override.id);
    return { model: override, candidates: [override, ...rest], reason: "Chosen in settings." };
  }
  return { model: candidates[0] ?? null, candidates, reason };
}

interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
  gpu?: { requestAdapter: (opts?: unknown) => Promise<GpuAdapterLike | null> };
}
interface GpuAdapterLike {
  features?: { has: (name: string) => boolean };
  limits?: { maxBufferSize?: number };
}

export function isMobileNavigator(nav: NavigatorLike | undefined): boolean {
  if (!nav) return false;
  if (typeof nav.userAgentData?.mobile === "boolean") return nav.userAgentData.mobile;
  const ua = nav.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS reports a Mac user agent; touch points give it away.
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

export async function probeDevice(
  nav: NavigatorLike | undefined = typeof navigator !== "undefined" ? (navigator as unknown as NavigatorLike) : undefined,
): Promise<DeviceProfile> {
  const wasm = typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  let webgpu = false;
  let shaderF16 = false;
  let maxBufferMb: number | null = null;
  try {
    const adapter = nav?.gpu ? await nav.gpu.requestAdapter() : null;
    if (adapter) {
      webgpu = true;
      shaderF16 = Boolean(adapter.features?.has("shader-f16"));
      const max = adapter.limits?.maxBufferSize;
      maxBufferMb = typeof max === "number" && Number.isFinite(max) ? Math.round(max / MB) : null;
    }
  } catch {
    webgpu = false;
  }
  const mem = nav?.deviceMemory;
  return {
    mobile: isMobileNavigator(nav),
    webgpu,
    shaderF16,
    deviceMemoryGb: typeof mem === "number" && Number.isFinite(mem) ? mem : null,
    maxBufferMb,
    wasm,
  };
}
