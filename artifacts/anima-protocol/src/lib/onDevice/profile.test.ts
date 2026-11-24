import { describe, it, expect } from "vitest";
import { pickOnDeviceModel, isMobileNavigator, probeDevice, type DeviceProfile } from "./profile";
import { onDeviceMindEnabled } from "./flag";

const base: DeviceProfile = {
  mobile: false,
  webgpu: true,
  shaderF16: true,
  deviceMemoryGb: 16,
  maxBufferMb: 4096,
  wasm: true,
};

describe("onDeviceMindEnabled", () => {
  it("is off by default", () => {
    expect(onDeviceMindEnabled({})).toBe(false);
    expect(onDeviceMindEnabled({ VITE_ANIMA_ON_DEVICE_MIND: "off" })).toBe(false);
    expect(onDeviceMindEnabled({ VITE_ANIMA_ON_DEVICE_MIND: "1" })).toBe(true);
  });
});

describe("pickOnDeviceModel", () => {
  it("picks Qwen3 4B on mobile", () => {
    const pick = pickOnDeviceModel({ ...base, mobile: true });
    expect(pick.model?.id).toBe("webllm:qwen3-4b-q4f16");
    expect(pick.candidates.map((m) => m.id)).toEqual(["webllm:qwen3-4b-q4f16", "wllama:qwen3-4b-q4km"]);
  });

  it("picks Qwen3 8B on a capable desktop, with 4B then wllama as local fallbacks", () => {
    const pick = pickOnDeviceModel(base);
    expect(pick.candidates.map((m) => m.id)).toEqual([
      "webllm:qwen3-8b-q4f16",
      "webllm:qwen3-4b-q4f16",
      "wllama:qwen3-4b-q4km",
    ]);
  });

  it("uses the 32-bit builds without shader-f16", () => {
    expect(pickOnDeviceModel({ ...base, shaderF16: false }).model?.id).toBe("webllm:qwen3-8b-q4f32");
  });

  it("drops to 4B on a low-memory desktop", () => {
    expect(pickOnDeviceModel({ ...base, deviceMemoryGb: 4 }).model?.id).toBe("webllm:qwen3-4b-q4f16");
  });

  it("falls back to wllama without WebGPU, and to nothing without wasm", () => {
    expect(pickOnDeviceModel({ ...base, webgpu: false }).model?.id).toBe("wllama:qwen3-4b-q4km");
    const none = pickOnDeviceModel({ ...base, webgpu: false, wasm: false });
    expect(none.model).toBeNull();
    expect(none.candidates).toEqual([]);
  });

  it("never lists a non-local engine", () => {
    for (const p of [base, { ...base, mobile: true }, { ...base, webgpu: false }]) {
      for (const m of pickOnDeviceModel(p).candidates) expect(["webllm", "wllama"]).toContain(m.engine);
    }
  });

  it("honours a settings override the device can run", () => {
    expect(pickOnDeviceModel(base, "webllm:qwen3-4b-q4f32").model?.id).toBe("webllm:qwen3-4b-q4f32");
    // A WebGPU model can't be forced on a device without WebGPU.
    expect(pickOnDeviceModel({ ...base, webgpu: false }, "webllm:qwen3-8b-q4f16").model?.id).toBe(
      "wllama:qwen3-4b-q4km",
    );
  });
});

describe("device probe", () => {
  it("detects phones, iPadOS and desktops", () => {
    expect(isMobileNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toBe(true);
    expect(isMobileNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe(true);
    expect(isMobileNavigator({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
    expect(isMobileNavigator({ userAgent: "x", userAgentData: { mobile: true } })).toBe(true);
  });

  it("reads WebGPU features and limits", async () => {
    const p = await probeDevice({
      userAgent: "Windows",
      deviceMemory: 8,
      gpu: {
        requestAdapter: async () => ({
          features: { has: (n: string) => n === "shader-f16" },
          limits: { maxBufferSize: 2 * 1024 * 1024 * 1024 },
        }),
      },
    });
    expect(p).toMatchObject({ webgpu: true, shaderF16: true, deviceMemoryGb: 8, maxBufferMb: 2048, mobile: false });
  });

  it("treats a failing adapter request as no WebGPU", async () => {
    const p = await probeDevice({
      userAgent: "Windows",
      gpu: {
        requestAdapter: async () => {
          throw new Error("blocked");
        },
      },
    });
    expect(p.webgpu).toBe(false);
  });
});
