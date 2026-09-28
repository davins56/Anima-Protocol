// The own model in the app: fetch the published version once, keep it on
// the device, and write replies with it (in a Web Worker when the browser
// has them). The server only records what it wrote — see
// artifacts/api-server/src/lib/ownModel.ts.

import { OwnModelEngine, DEFAULT_MAX_TOKENS } from "./engine.js";

/** Sampling for chat turns: cooler than the main chain so taught replies show. */
export const OWN_MODEL_TEMPERATURE = 0.6;
/** Earlier turns handed to the model; it only fits ~256 tokens anyway. */
export const OWN_MODEL_HISTORY_TURNS = 12;

const DB_NAME = "anima-own-model";
const STORE = "weights";

function isHiddenSpeaker(message) {
  const name = message?.character_name;
  return name === "__typing__" || name === "__thinking__";
}

/** The chat as the own model sees it: plain user / assistant turns. */
export function ownModelHistory(messages, limit = OWN_MODEL_HISTORY_TURNS) {
  const turns = [];
  for (const message of messages || []) {
    if (!message || message.type === "event" || message.is_streaming || isHiddenSpeaker(message)) continue;
    const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : null;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (role && content) turns.push({ role, content });
  }
  return turns.slice(-limit);
}

// ------------------------------------------------------------------ weights

async function sha256Hex(buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Download one published version: its chunks in order, a few at a time,
 * checked against the size and checksum the server published.
 * @param {{ version: number, inference: { bytes: number, chunks: number, sha256?: string | null } }} model
 * @param {(version: number, idx: number) => Promise<ArrayBuffer>} fetchChunk
 */
export async function downloadModel(model, fetchChunk, { onProgress, concurrency = 4 } = {}) {
  const { chunks, bytes, sha256 } = model.inference;
  const parts = new Array(chunks);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < chunks) {
      const idx = next++;
      parts[idx] = new Uint8Array(await fetchChunk(model.version, idx));
      done += 1;
      onProgress?.(done / chunks);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks) }, worker));
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  if (total !== bytes) throw new Error("The model download was incomplete.");
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  if (sha256) {
    const got = await sha256Hex(joined.buffer);
    if (got && got !== sha256) throw new Error("The model download was corrupted.");
  }
  return joined.buffer;
}

function openCache() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no IndexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(model) {
  return `v${model.version}:${model.inference.sha256 || model.inference.bytes}`;
}

/** The weights kept on this device, or null. Never throws. */
export async function readCachedModel(model) {
  try {
    const db = await openCache();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(cacheKey(model));
      req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? req.result : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Keep only this version on the device. Best effort: a private window may refuse. */
export async function writeCachedModel(model, buffer) {
  try {
    const db = await openCache();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      store.put(buffer, cacheKey(model));
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  } catch {
    // Next chat downloads it again.
  }
}

// ------------------------------------------------------------------ runner

/** Runs the engine in a Web Worker, or inline where there are none (tests, old browsers). */
export class OwnModelRunner {
  constructor({ useWorker = typeof Worker !== "undefined" } = {}) {
    this.useWorker = useWorker;
    this.worker = null;
    this.engine = null;
    this.version = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  startWorker() {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const msg = event.data || {};
      const job = this.pending.get(msg.id);
      if (!job) return;
      if (msg.type === "delta") job.onDelta?.(msg.text);
      else if (msg.type === "loaded" || msg.type === "done") {
        this.pending.delete(msg.id);
        job.resolve(msg.result ?? msg.config);
      } else if (msg.type === "error") {
        this.pending.delete(msg.id);
        job.reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      const err = new Error(event?.message || "The model stopped unexpectedly.");
      for (const job of this.pending.values()) job.reject(err);
      this.pending.clear();
      this.worker = null;
      this.version = null;
    };
    return worker;
  }

  post(message, onDelta, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, onDelta });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  async load(buffer, version) {
    if (this.useWorker) {
      try {
        if (!this.worker) this.worker = this.startWorker();
        // Keep a copy: a transferred buffer is gone from this thread.
        await this.post({ type: "load", buffer: buffer.slice(0), version });
        this.version = version;
        return;
      } catch {
        this.worker?.terminate();
        this.worker = null;
        this.useWorker = false;
      }
    }
    this.engine = new OwnModelEngine(buffer);
    this.version = version;
  }

  /**
   * Write a reply. `onDelta` gets the reply so far as it grows.
   * @returns {Promise<{ text: string, finish: string }>}
   */
  async generate(messages, { maxTokens = DEFAULT_MAX_TOKENS, temperature = OWN_MODEL_TEMPERATURE, onDelta } = {}) {
    const options = { maxTokens, temperature };
    if (this.worker) return this.post({ type: "generate", messages, options }, onDelta);
    if (!this.engine) throw new Error("The model is not loaded yet.");
    const it = this.engine.generate(messages, options);
    let text = "";
    let step = it.next();
    while (!step.done) {
      text += step.value;
      onDelta?.(text);
      step = it.next();
    }
    return { text: step.value.text, finish: step.value.finish };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
    this.version = null;
  }
}

let shared = null;
let loading = null;

/**
 * The runner for `model` (from GET /api/model/config), loading its weights
 * from the device cache or the server the first time.
 */
export async function ensureOwnModel(model, fetchChunk, { onProgress } = {}) {
  if (shared?.version === model.version) return shared;
  if (loading?.version === model.version) return loading.promise;
  const promise = (async () => {
    let buffer = await readCachedModel(model);
    if (!buffer) {
      buffer = await downloadModel(model, fetchChunk, { onProgress });
      await writeCachedModel(model, buffer);
    }
    const runner = shared && shared.version !== model.version ? shared : new OwnModelRunner();
    await runner.load(buffer, model.version);
    shared = runner;
    return runner;
  })();
  loading = { version: model.version, promise };
  try {
    return await promise;
  } finally {
    if (loading?.promise === promise) loading = null;
  }
}

export function resetOwnModelForTests() {
  shared?.dispose();
  shared = null;
  loading = null;
}
