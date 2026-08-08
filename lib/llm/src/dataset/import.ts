/**
 * Import raw chat logs from disk into TrainingExample[] for fine-tuning.
 *
 * Point this at a folder of your own cleaned Serenity / Fallen Angel arcs
 * (or any companion transcripts) and it will normalize them alongside the
 * curated seed turns and Postgres exports. Per-file format is auto-detected:
 *
 *  - TrainingExample JSON/JSONL — passed through as-is (id/source filled in
 *    if missing); malformed records are skipped
 *  - ShareGPT JSON: { conversations: [{ from: "human"|"gpt"|"system", value }], system? }
 *  - Plain-text transcript: alternating "User: ..." / "<Character>: ..." lines
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatTurn, TrainingExample } from "./types";

export interface ImportLogsOptions {
  /**
   * Character name to attribute assistant turns to. For plain-text
   * transcripts with more than one non-user speaker, only lines from this
   * speaker become assistant turns — everything else (narrator lines, other
   * companions) is folded into context instead of being trained as this
   * character's own speech. Leave unset to keep the most-frequent speaker.
   */
  defaultCharacterName?: string;
  /** Minimum non-system turns to keep an example (default 2). */
  minTurns?: number;
  tags?: string[];
}

const SUPPORTED_EXTENSIONS = new Set([".json", ".jsonl", ".txt", ".md"]);
const VALID_ROLES = new Set(["system", "user", "assistant"]);

function isValidChatTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.role === "string" &&
    VALID_ROLES.has(v.role) &&
    typeof v.content === "string" &&
    (v.name === undefined || typeof v.name === "string")
  );
}

function isTrainingExampleShape(value: unknown): value is TrainingExample {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.conversation) || !v.conversation.every(isValidChatTurn)) return false;
  if (!v.character || typeof v.character !== "object") return false;
  const name = (v.character as Record<string, unknown>).name;
  return typeof name === "string" && name.trim().length > 0;
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
  defaultCharacterName: string | undefined,
): TrainingExample {
  const characterName = defaultCharacterName || "Companion";
  const conversation: ChatTurn[] = [];
  if (data.system?.trim()) conversation.push({ role: "system", content: data.system.trim() });

  for (const turn of data.conversations) {
    switch (turn.from) {
      case "system":
        conversation.push({ role: "system", content: turn.value });
        break;
      case "human":
        conversation.push({ role: "user", content: turn.value });
        break;
      case "gpt":
      case "assistant":
        conversation.push({ role: "assistant", content: turn.value, name: characterName });
        break;
      default:
        console.warn(`[import] ${id}: skipping ShareGPT turn with unsupported role "${turn.from}"`);
    }
  }

  return { id, source, character: { name: characterName }, conversation };
}

const TRANSCRIPT_LINE = /^([A-Za-z][\w' -]{0,40}):\s*(.+)$/;
const USER_ALIASES = /^(user|you|me)$/i;

function fromTranscriptText(
  text: string,
  id: string,
  source: string,
  restrictToCharacter: string | undefined,
): TrainingExample | null {
  const lines = text.split(/\r?\n/);
  const conversation: ChatTurn[] = [];
  const speakerCounts = new Map<string, number>();
  // Non-target speaker lines (narrator, other companions) are context for
  // the target character's *next* reply, not for whichever turn happens to
  // be last — that could be the user's own line, or there may be no turn
  // yet at all if the interjection comes first.
  let lastAssistantTurn: ChatTurn | null = null;
  let pendingContext: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(TRANSCRIPT_LINE);
    if (!match) {
      const last = conversation[conversation.length - 1];
      if (last) last.content += `\n${line}`;
      else pendingContext.push(line);
      continue;
    }
    const [, speakerRaw, content] = match;
    const speaker = speakerRaw.trim();

    if (USER_ALIASES.test(speaker)) {
      conversation.push({ role: "user", content: content.trim() });
      continue;
    }

    if (restrictToCharacter && speaker.toLowerCase() !== restrictToCharacter.toLowerCase()) {
      // Narrator / other-character line — keep as context instead of
      // training it as the target character's own speech. Only fold onto
      // the assistant's turn if nothing has happened since (i.e. it's still
      // the most recent turn) — otherwise a user turn came in between, so
      // this interjection belongs to the *next* reply, not the last one.
      const note = `[${speaker}]: ${content.trim()}`;
      const last = conversation[conversation.length - 1];
      if (lastAssistantTurn && last === lastAssistantTurn) lastAssistantTurn.content += `\n${note}`;
      else pendingContext.push(note);
      continue;
    }

    speakerCounts.set(speaker, (speakerCounts.get(speaker) || 0) + 1);
    const prefix = pendingContext.length ? `${pendingContext.join("\n")}\n` : "";
    pendingContext = [];
    const turn: ChatTurn = { role: "assistant", content: `${prefix}${content.trim()}`, name: speaker };
    conversation.push(turn);
    lastAssistantTurn = turn;
  }

  // If a character was requested but never actually spoke, every "assistant"
  // turn got folded away as context — don't export a userturns-only example.
  if (restrictToCharacter && !lastAssistantTurn) return null;
  if (conversation.filter((t) => t.role !== "system").length < 2) return null;

  const characterName =
    restrictToCharacter || [...speakerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Companion";

  return { id, source, character: { name: characterName }, conversation };
}

function normalizeParsed(
  parsed: unknown,
  id: string,
  source: string,
  defaultCharacterName: string | undefined,
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
  const source = `import:${base}`;
  const minTurns = opts.minTurns ?? 2;
  const results: TrainingExample[] = [];

  if (ext === ".jsonl") {
    let i = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      i += 1;
      try {
        results.push(...normalizeParsed(JSON.parse(line), `${base}-${i}`, source, opts.defaultCharacterName));
      } catch {
        console.warn(`[import] ${base}: skipping malformed JSONL line ${i}`);
      }
    }
  } else if (ext === ".json") {
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      arr.forEach((item, i) => {
        results.push(...normalizeParsed(item, `${base}-${i}`, source, opts.defaultCharacterName));
      });
    } catch (err) {
      console.warn(`[import] skipping malformed JSON file ${base}: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    const example = fromTranscriptText(raw, base, source, opts.defaultCharacterName);
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }

  const examples: TrainingExample[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".") || entry.toLowerCase() === "readme.md") continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
    examples.push(...(await importLogFile(path.join(dir, entry), opts)));
  }
  return examples;
}
