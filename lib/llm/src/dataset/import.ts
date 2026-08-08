/**
 * Import raw chat logs from disk into TrainingExample[] for fine-tuning.
 *
 * Point this at a folder of your own cleaned Serenity / Fallen Angel arcs
 * (or any companion transcripts) and it will normalize them alongside the
 * curated seed turns and Postgres exports. Per-file format is auto-detected:
 *
 *  - TrainingExample JSON/JSONL — passed through as-is (id/source filled in
 *    if missing)
 *  - ShareGPT JSON: { conversations: [{ from: "human"|"gpt"|"system", value }], system? }
 *  - Plain-text transcript: alternating "User: ..." / "<Character>: ..." lines
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatTurn, TrainingExample } from "./types";

export interface ImportLogsOptions {
  /** Character name to attribute assistant turns to when not inferable. */
  defaultCharacterName?: string;
  /** Minimum non-system turns to keep an example (default 2). */
  minTurns?: number;
  tags?: string[];
}

const SUPPORTED_EXTENSIONS = new Set([".json", ".jsonl", ".txt", ".md"]);

function isTrainingExampleShape(value: unknown): value is TrainingExample {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).conversation) &&
    !!(value as Record<string, unknown>).character
  );
}

function isShareGptShape(
  value: unknown,
): value is { conversations: Array<{ from: string; value: string }>; system?: string } {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as Record<string, unknown>).conversations)
  );
}

function fromShareGpt(
  data: { conversations: Array<{ from: string; value: string }>; system?: string },
  id: string,
  source: string,
  defaultCharacterName: string,
): TrainingExample {
  const conversation: ChatTurn[] = [];
  if (data.system?.trim()) conversation.push({ role: "system", content: data.system.trim() });
  for (const turn of data.conversations) {
    if (turn.from === "system") {
      conversation.push({ role: "system", content: turn.value });
    } else if (turn.from === "human") {
      conversation.push({ role: "user", content: turn.value });
    } else {
      conversation.push({ role: "assistant", content: turn.value, name: defaultCharacterName });
    }
  }
  return { id, source, character: { name: defaultCharacterName }, conversation };
}

const TRANSCRIPT_LINE = /^([A-Za-z][\w' -]{0,40}):\s*(.+)$/;
const USER_ALIASES = /^(user|you|me)$/i;

function fromTranscriptText(
  text: string,
  id: string,
  source: string,
  defaultCharacterName: string,
): TrainingExample | null {
  const lines = text.split(/\r?\n/);
  const conversation: ChatTurn[] = [];
  let characterName = defaultCharacterName;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(TRANSCRIPT_LINE);
    if (!match) {
      const last = conversation[conversation.length - 1];
      if (last) last.content += `\n${line}`;
      continue;
    }
    const [, speaker, content] = match;
    const isUser = USER_ALIASES.test(speaker.trim());
    if (!isUser) characterName = speaker.trim();
    conversation.push({
      role: isUser ? "user" : "assistant",
      content: content.trim(),
      name: isUser ? undefined : characterName,
    });
  }

  if (conversation.filter((t) => t.role !== "system").length < 2) return null;
  return { id, source, character: { name: characterName }, conversation };
}

function normalizeParsed(
  parsed: unknown,
  id: string,
  source: string,
  defaultCharacterName: string,
): TrainingExample[] {
  if (isTrainingExampleShape(parsed)) {
    return [{ ...parsed, id: parsed.id || id, source: parsed.source || source }];
  }
  if (isShareGptShape(parsed)) {
    return [fromShareGpt(parsed, id, source, defaultCharacterName)];
  }
  return [];
}

/** Parse a single log file into zero or more TrainingExamples. */
export async function importLogFile(
  filePath: string,
  opts: ImportLogsOptions = {},
): Promise<TrainingExample[]> {
  const raw = await readFile(filePath, "utf8");
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const defaultCharacterName = opts.defaultCharacterName || "Companion";
  const source = `import:${base}`;
  const minTurns = opts.minTurns ?? 2;
  const results: TrainingExample[] = [];

  if (ext === ".jsonl") {
    let i = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      i += 1;
      try {
        results.push(...normalizeParsed(JSON.parse(line), `${base}-${i}`, source, defaultCharacterName));
      } catch {
        // skip malformed line
      }
    }
  } else if (ext === ".json") {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    arr.forEach((item, i) => {
      results.push(...normalizeParsed(item, `${base}-${i}`, source, defaultCharacterName));
    });
  } else {
    const example = fromTranscriptText(raw, base, source, defaultCharacterName);
    if (example) results.push(example);
  }

  return results
    .filter((ex) => ex.conversation.filter((t) => t.role !== "system").length >= minTurns)
    .map((ex) => (opts.tags?.length ? { ...ex, tags: [...(ex.tags || []), ...opts.tags] } : ex));
}

/** Parse every supported file in a directory into TrainingExamples. Missing dir → []. */
export async function importLogsDir(
  dir: string,
  opts: ImportLogsOptions = {},
): Promise<TrainingExample[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const examples: TrainingExample[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".") || entry.toLowerCase() === "readme.md") continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
    examples.push(...(await importLogFile(path.join(dir, entry), opts)));
  }
  return examples;
}
