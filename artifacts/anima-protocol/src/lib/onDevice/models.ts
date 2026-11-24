/**
 * Chat upgrade 3: on-device model catalog (WebLLM first, wllama fallback).
 *
 * Qwen3 4B on phones and tablets, Qwen3 8B on desktops with enough GPU
 * memory. wllama (llama.cpp in WebAssembly) is the fallback when WebGPU is
 * missing; it is capped at 4B because one wasm instance holds 4 GB and the app
 * does not send the COOP/COEP headers multi-instance loading needs.
 *
 * All of these run on the device. None of them is a cloud model.
 */

export type OnDeviceEngineKind = "webllm" | "wllama";

export interface OnDeviceModel {
  /** Stable id used in settings and storage. */
  id: string;
  engine: OnDeviceEngineKind;
  label: string;
  /** WebLLM prebuilt model id, or the Hugging Face repo + file for wllama. */
  webllmId?: string;
  hf?: { repo: string; file: string };
  /** Rough download size, for the confirm text. */
  approxDownloadMb: number;
  /** WebLLM's own VRAM estimate (MB); wllama is CPU/RAM. */
  approxMemoryMb: number;
  params: "4B" | "8B";
}

export const ON_DEVICE_MODELS: readonly OnDeviceModel[] = [
  {
    id: "webllm:qwen3-8b-q4f16",
    engine: "webllm",
    label: "Qwen3 8B (WebGPU, 16-bit)",
    webllmId: "Qwen3-8B-q4f16_1-MLC",
    approxDownloadMb: 4600,
    approxMemoryMb: 5696,
    params: "8B",
  },
  {
    id: "webllm:qwen3-8b-q4f32",
    engine: "webllm",
    label: "Qwen3 8B (WebGPU, 32-bit)",
    webllmId: "Qwen3-8B-q4f32_1-MLC",
    approxDownloadMb: 4600,
    approxMemoryMb: 6853,
    params: "8B",
  },
  {
    id: "webllm:qwen3-4b-q4f16",
    engine: "webllm",
    label: "Qwen3 4B (WebGPU, 16-bit)",
    webllmId: "Qwen3-4B-q4f16_1-MLC",
    approxDownloadMb: 2300,
    approxMemoryMb: 3432,
    params: "4B",
  },
  {
    id: "webllm:qwen3-4b-q4f32",
    engine: "webllm",
    label: "Qwen3 4B (WebGPU, 32-bit)",
    webllmId: "Qwen3-4B-q4f32_1-MLC",
    approxDownloadMb: 2300,
    approxMemoryMb: 4328,
    params: "4B",
  },
  {
    id: "wllama:qwen3-4b-q4km",
    engine: "wllama",
    label: "Qwen3 4B (WebAssembly fallback)",
    hf: { repo: "Qwen/Qwen3-4B-GGUF", file: "Qwen3-4B-Q4_K_M.gguf" },
    approxDownloadMb: 2500,
    approxMemoryMb: 3200,
    params: "4B",
  },
];

export function modelById(id: string | null | undefined): OnDeviceModel | null {
  return ON_DEVICE_MODELS.find((m) => m.id === id) ?? null;
}
