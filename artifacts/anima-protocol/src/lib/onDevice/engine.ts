/**
 * Chat upgrade 3: load and run an on-device model.
 *
 * Fail closed: every candidate here runs on this device (WebLLM on WebGPU,
 * then wllama in WebAssembly). If none loads, the result is "unavailable".
 * Nothing in this module ever calls the API, a cloud model, or any other
 * remote inference endpoint. Model weights are downloaded once from Hugging
 * Face (and WebLLM's model library from GitHub) and cached by the browser.
 *
 * The libraries are imported lazily so they never enter the main bundle.
 */
import type { OnDeviceModel } from "./models";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface LoadProgress {
  model: OnDeviceModel;
  /** 0..1, or null while unknown. */
  fraction: number | null;
  text: string;
}

export interface GenerateOptions {
  signal?: AbortSignal;
  onToken?: (delta: string, full: string) => void;
  maxTokens?: number;
  temperature?: number;
}

export interface OnDeviceEngine {
  model: OnDeviceModel;
  generate(messages: ChatTurn[], opts?: GenerateOptions): Promise<string>;
  unload(): Promise<void>;
}

export interface LoadResult {
  engine: OnDeviceEngine | null;
  /** One entry per candidate that failed, in order tried. */
  failures: { model: OnDeviceModel; message: string }[];
}

/** Qwen3 thinks out loud by default; the companion should not. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/^\s+/, "");
}

function abortError(): Error {
  const err = new Error("Stopped");
  err.name = "AbortError";
  return err;
}

async function loadWebLlm(model: OnDeviceModel, onProgress?: (p: LoadProgress) => void): Promise<OnDeviceEngine> {
  const webllm = await import("@mlc-ai/web-llm");
  const worker = new Worker(new URL("./webllmWorker.ts", import.meta.url), { type: "module" });
  let engine;
  try {
    engine = await webllm.CreateWebWorkerMLCEngine(worker, model.webllmId as string, {
      initProgressCallback: (r: { progress: number; text: string }) =>
        onProgress?.({ model, fraction: Number.isFinite(r.progress) ? r.progress : null, text: r.text }),
    });
  } catch (err) {
    worker.terminate();
    throw err;
  }
  const loaded = engine;
  return {
    model,
    async generate(messages, opts = {}) {
      if (opts.signal?.aborted) throw abortError();
      const onAbort = () => {
        void loaded.interruptGenerate();
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      let full = "";
      try {
        const stream = await loaded.chat.completions.create({
          messages,
          stream: true,
          max_tokens: opts.maxTokens ?? 512,
          temperature: opts.temperature ?? 0.8,
          extra_body: { enable_thinking: false },
        });
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content || "";
          if (!delta) continue;
          full += delta;
          opts.onToken?.(delta, stripThinking(full));
        }
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
      }
      if (opts.signal?.aborted) throw abortError();
      return stripThinking(full);
    },
    async unload() {
      try {
        await loaded.unload();
      } finally {
        worker.terminate();
      }
    },
  };
}

async function loadWllama(model: OnDeviceModel, onProgress?: (p: LoadProgress) => void): Promise<OnDeviceEngine> {
  const [{ Wllama }, wasm] = await Promise.all([
    import("@wllama/wllama"),
    import("@wllama/wllama/esm/wasm/wllama.wasm?url"),
  ]);
  const wllama = new Wllama({ default: wasm.default });
  const hf = model.hf as { repo: string; file: string };
  await wllama.loadModelFromHF(
    { repo: hf.repo, file: hf.file },
    {
      n_ctx: 4096,
      progressCallback: ({ loaded, total }: { loaded: number; total: number }) =>
        onProgress?.({
          model,
          fraction: total > 0 ? loaded / total : null,
          text: `Downloading ${Math.round(loaded / (1024 * 1024))} MB`,
        }),
    },
  );
  return {
    model,
    async generate(messages, opts = {}) {
      if (opts.signal?.aborted) throw abortError();
      let full = "";
      const stream = await wllama.createChatCompletion({
        messages,
        stream: true,
        max_tokens: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.8,
        abortSignal: opts.signal,
        chat_template_kwargs: { enable_thinking: false },
      });
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (!delta) continue;
        full += delta;
        opts.onToken?.(delta, stripThinking(full));
      }
      if (opts.signal?.aborted) throw abortError();
      return stripThinking(full);
    },
    async unload() {
      await wllama.exit();
    },
  };
}

export type EngineLoader = (model: OnDeviceModel, onProgress?: (p: LoadProgress) => void) => Promise<OnDeviceEngine>;

const DEFAULT_LOADERS: Record<OnDeviceModel["engine"], EngineLoader> = {
  webllm: loadWebLlm,
  wllama: loadWllama,
};

/**
 * Try each candidate in order (all on-device). Stops at the first that loads.
 * `loaders` is injectable for tests.
 */
export async function loadOnDeviceEngine(
  candidates: OnDeviceModel[],
  opts: { onProgress?: (p: LoadProgress) => void; signal?: AbortSignal; loaders?: Partial<typeof DEFAULT_LOADERS> } = {},
): Promise<LoadResult> {
  const loaders = { ...DEFAULT_LOADERS, ...(opts.loaders || {}) };
  const failures: LoadResult["failures"] = [];
  for (const model of candidates) {
    if (opts.signal?.aborted) break;
    const load = loaders[model.engine];
    if (!load) continue;
    try {
      const engine = await load(model, opts.onProgress);
      if (opts.signal?.aborted) {
        await engine.unload().catch(() => {});
        break;
      }
      return { engine, failures };
    } catch (err) {
      failures.push({ model, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { engine: null, failures };
}

/** Remove cached weights for one model from this device. */
export async function removeOnDeviceModel(model: OnDeviceModel): Promise<void> {
  if (model.engine === "webllm") {
    const webllm = await import("@mlc-ai/web-llm");
    await webllm.deleteModelAllInfoInCache(model.webllmId as string);
    return;
  }
  const [{ Wllama }, wasm] = await Promise.all([
    import("@wllama/wllama"),
    import("@wllama/wllama/esm/wasm/wllama.wasm?url"),
  ]);
  const wllama = new Wllama({ default: wasm.default });
  await wllama.cacheManager.clear();
}
