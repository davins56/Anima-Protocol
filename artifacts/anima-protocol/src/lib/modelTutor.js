// Model Tutor — client helpers for running and teaching the own model.
// The API is steward-only (see artifacts/api-server/src/routes/modelTutor.ts).

import { parseInferenceBlob } from "@/lib/ownModel/blob.js";

/** Earlier turns sent with a lesson. The model only sees ~256 tokens anyway. */
export const TEACH_CONTEXT_TURNS = 12;

/** Replies longer than this rarely fit the own model's memory whole. */
export const LONG_REPLY_CHARS = 600;

function isHiddenSpeaker(message) {
  const name = message?.character_name;
  return name === "__typing__" || name === "__thinking__";
}

/**
 * The conversation before `index`, as user/assistant turns — what the model
 * saw when it gave the reply being corrected.
 * @param {Array<object>} messages
 * @param {number} index
 */
export function teachableContext(messages, index) {
  const turns = [];
  for (const message of (messages || []).slice(0, Math.max(index, 0))) {
    if (!message || message.type === "event" || isHiddenSpeaker(message)) continue;
    const role =
      message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : null;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (!role || !content) continue;
    turns.push({ role, content });
  }
  return turns.slice(-TEACH_CONTEXT_TURNS);
}

/**
 * Everything the Teach dialog needs about one assistant reply.
 * `subMessage` / `part` identify one speaker inside a split group reply.
 */
export function buildTeachTarget({ session, messages, index, subMessage = null, part = null }) {
  const message = subMessage || messages?.[index];
  if (!message || message.role !== "assistant" || isHiddenSpeaker(message)) return null;
  return {
    session_id: session?.id || null,
    message_id: messages?.[index]?.id || null,
    part: Number.isInteger(part) ? part : null,
    context: teachableContext(messages, index),
    rejected: String(message.content || "").trim(),
    // Split group replies are rebuilt per speaker; the brand stays on the parent.
    source_brand: message.llm_brand || messages?.[index]?.llm_brand || null,
    character_name: message.character_name || null,
  };
}

/** True when the reply came from the steward's own model. */
export function isOwnModelReply(message) {
  return message?.llm_brand === "own";
}

export function lessonStatusLabel(lesson) {
  switch (lesson?.status) {
    case "learned":
      return "Learned";
    case "failed":
      return (lesson.attempts ?? 0) >= 3 ? "Didn't take" : "Retrying";
    default:
      return "Waiting to learn";
  }
}

/**
 * The server reports loss in nats per token; exp(-loss) is how likely the
 * model found each word of the reply, which reads better than a loss.
 * @param {number | null | undefined} loss
 */
export function wordChancePercent(loss) {
  if (typeof loss !== "number" || !Number.isFinite(loss)) return null;
  const pct = Math.exp(-loss) * 100;
  if (pct >= 10) return Math.round(pct);
  if (pct >= 1) return Math.round(pct * 10) / 10;
  return Math.max(Math.round(pct * 100) / 100, 0.01);
}

/** "1% → 73% per word" once a lesson has been learned, else null. */
export function describeLearning(lesson) {
  const before = wordChancePercent(lesson?.loss_before);
  const after = wordChancePercent(lesson?.loss_after);
  if (before == null || after == null) return null;
  return `${before}% → ${after}% per word`;
}

// ------------------------------------------------------------------ model file

const BUNDLE_MAGIC = "ANIMAMDL";
/** Must match the api-server's BLOB_CHUNK_BYTES. */
export const UPLOAD_CHUNK_BYTES = 512 * 1024;

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Read a model file from server/export_web.py ("anima-model-1"): the
 * browser-ready weights and the full-precision copy the trainer learns on.
 * Checks both parts, and that the browser engine can actually read it.
 * @param {ArrayBuffer} buffer
 */
export async function parseModelBundle(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  if (magic !== BUNDLE_MAGIC) {
    throw new Error("That isn't an Anima model file. Export one with server/export_web.py.");
  }
  const headerLength = new DataView(buffer).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)));
  let offset = 12 + headerLength;
  const parts = {};
  for (const part of header.parts || []) {
    const data = bytes.subarray(offset, offset + part.bytes);
    if (data.byteLength !== part.bytes || (await sha256Hex(data)) !== part.sha256) {
      throw new Error("The model file is damaged — export it again.");
    }
    parts[part.name] = { data, sha256: part.sha256 };
    offset += part.bytes;
  }
  if (!parts.inference || !parts.master) throw new Error("The model file is missing a part.");
  const inference = parts.inference.data;
  parseInferenceBlob(inference.buffer.slice(inference.byteOffset, inference.byteOffset + inference.byteLength));
  return { config: header.config, inference: parts.inference, master: parts.master };
}

/**
 * Upload a parsed model file in chunks and publish it as the new base.
 * `onProgress` gets 0..1.
 */
export async function uploadModelBundle(api, bundle, { onProgress } = {}) {
  const started = await api.startUpload({
    config: bundle.config,
    inference: { bytes: bundle.inference.data.byteLength, sha256: bundle.inference.sha256 },
    master: { bytes: bundle.master.data.byteLength },
  });
  const version = started.version;
  const chunkBytes = started.chunk_bytes || UPLOAD_CHUNK_BYTES;
  const kinds = [
    ["inference", bundle.inference.data],
    ["master", bundle.master.data],
  ];
  const total = kinds.reduce((sum, [, data]) => sum + Math.ceil(data.byteLength / chunkBytes), 0);
  let sent = 0;
  try {
    for (const [kind, data] of kinds) {
      for (let idx = 0; idx * chunkBytes < data.byteLength; idx++) {
        const chunk = data.slice(idx * chunkBytes, (idx + 1) * chunkBytes);
        for (let attempt = 1; ; attempt++) {
          try {
            await api.uploadChunk(version, kind, idx, chunk);
            break;
          } catch (err) {
            if (attempt >= 3 || (err?.status && err.status < 500)) throw err;
          }
        }
        sent += 1;
        onProgress?.(sent / total);
      }
    }
    return await api.finishUpload(version);
  } catch (err) {
    api.cancelUpload?.(version).catch?.(() => {});
    throw err;
  }
}

/** One line on what the background trainer did last, for the panel. */
export function describeTrainer(trainer, now = Date.now()) {
  const run = trainer?.last_run;
  const ago = (iso) => {
    const ms = now - Date.parse(iso || "");
    if (!Number.isFinite(ms)) return null;
    const min = Math.round(ms / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hours = Math.round(min / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
  };
  if (run?.status === "running") return `Learning now (started ${ago(run.at) || "recently"}).`;
  const checked = ago(trainer?.checked_at);
  if (!run && !checked) {
    return "The trainer hasn't run yet. Add the DATABASE_URL secret to GitHub Actions (see docs/own-model.md).";
  }
  const last = run ? `Last run ${ago(run.at)}: ${run.message || run.status}` : "No learning runs yet.";
  return checked ? `${last} Checked for lessons ${checked}.` : last;
}

/** Save text as a file (lesson exports for the offline training pipeline). */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
