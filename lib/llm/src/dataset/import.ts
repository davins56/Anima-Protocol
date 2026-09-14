/**
 * Import raw chat logs from disk into TrainingExample[] for fine-tuning.
 *
 * Point this at a folder of your own cleaned Serenity / Fallen Angel arcs
 * (or any companion transcripts) and it will normalize them alongside the
 * curated seed turns and Postgres exports. Per-file format is auto-detected:
 *
 *  - Anima Settings backup (`anima-backup-*.json`) — ChatSession + ChatMessage
 *    (+ Character / Anima / CharacterMemory). Defaults to Serenity + Fallen Angel.
 *  - TrainingExample JSON/JSONL — passed through as-is (id/source filled in
 *    if missing); malformed records are skipped
 *  - ShareGPT JSON: { conversations: [{ from: "human"|"gpt"|"system", value }], system? }
 *  - ChatML JSON: { messages: [{ role, content }] }
 *  - Plain-text transcript: alternating "User: ..." / "<Character>: ..." lines
 *
 * Directories are walked recursively. README.md and dotfiles are skipped.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ChatTurn, TrainingExample } from "./types";
import { splitExampleByCharacters } from "./split";
import {
  fromAnimaBackup,
  fromChatMl,
  isAnimaBackup,
  isChatMlShape,
} from "./sources";
import { characterNameFromSystem } from "./characters";

export interface ImportLogsOptions {
  /**
   * Character name to attribute assistant turns to. For plain-text
   * transcripts with more than one non-user speaker, only lines from this
   * speaker become assistant turns — everything else (narrator lines, other
   * companions) is folded into context instead of being trained as this
   * character's own speech. Leave unset to keep the most-frequent speaker.
   */
  defaultCharacterName?: string;
  /**
   * Split imported conversations into one example per named companion.
   * Anima Settings backups default to Serenity + Fallen Angel when this
   * (and `defaultCharacterName`) is unset — pass `allCharacters: true` to
   * keep every companion in the backup.
   */
  characterNames?: string[];
  /** Do not default Anima backups to the Serenity / Fallen Angel filter. */
  allCharacters?: boolean;
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
  const characterName =
    defaultCharacterName || characterNameFromSystem(data.system) || "Companion";
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
  // Non-target speaker lines (narrator, other companions) are always queued
  // as context for the target character's *next* reply.
  let lastAssistantTurn: ChatTurn | null = null;
  let pendingContext: string[] = [];
  // What a continuation line (no "Speaker:" prefix) should attach to. A
  // pending interjection can outlive an intervening user turn — it isn't
  // consumed until the target character's next reply — so this can't be
  // inferred from pendingContext.length alone; it has to track the actual
  // last thing written.
  let lastWrite: "turn" | "pending" | "none" = "none";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(TRANSCRIPT_LINE);
    if (!match) {
      if (lastWrite === "pending") {
        pendingContext[pendingContext.length - 1] += `\n${line}`;
      } else {
        const last = conversation[conversation.length - 1];
        if (last) {
          last.content += `\n${line}`;
        } else {
          pendingContext.push(line);
          lastWrite = "pending";
        }
      }
      continue;
    }
    const [, speakerRaw, content] = match;
    const speaker = speakerRaw.trim();

    if (USER_ALIASES.test(speaker)) {
      conversation.push({ role: "user", content: content.trim() });
      lastWrite = "turn";
      continue;
    }

    if (restrictToCharacter && speaker.toLowerCase() !== restrictToCharacter.toLowerCase()) {
      // Narrator / other-character line — always queue as context for the
      // character's *next* reply. Never mutate an already-emitted turn: that
      // would put foreign dialogue inside a turn attributed to the target
      // character regardless of whether it's appended or prefixed, teaching
      // the model to speak for someone else.
      pendingContext.push(`[${speaker}]: ${content.trim()}`);
      lastWrite = "pending";
      continue;
    }

    speakerCounts.set(speaker, (speakerCounts.get(speaker) || 0) + 1);
    const prefix = pendingContext.length ? `${pendingContext.join("\n")}\n` : "";
    pendingContext = [];
    const turn: ChatTurn = { role: "assistant", content: `${prefix}${content.trim()}`, name: speaker };
    conversation.push(turn);
    lastAssistantTurn = turn;
    lastWrite = "turn";
  }

  // If a character was requested but never actually spoke, every "assistant"
  // turn got folded away as context — don't export a userturns-only example.
  if (restrictToCharacter && !lastAssistantTurn) return null;
  if (conversation.filter((t) => t.role !== "system").length < 2) return null;

  const characterName =
    restrictToCharacter || [...speakerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Companion";

  return { id, source, character: { name: characterName }, conversation };
}

function requestedNames(opts: ImportLogsOptions): string[] | undefined {
  if (opts.characterNames?.length) return opts.characterNames;
  if (opts.defaultCharacterName) return [opts.defaultCharacterName];
  return undefined;
}

function applyCharacterSplit(
  examples: TrainingExample[],
  names: string[] | undefined,
): TrainingExample[] {
  if (!names?.length) return examples;
  return examples.flatMap((ex) => splitExampleByCharacters(ex, names));
}

function normalizeParsed(
  parsed: unknown,
  id: string,
  source: string,
  opts: ImportLogsOptions,
): TrainingExample[] {
  if (isAnimaBackup(parsed)) {
    return fromAnimaBackup(parsed, {
      source,
      defaultCharacterName: opts.defaultCharacterName,
      characterNames: opts.characterNames,
      allCharacters: opts.allCharacters,
      minTurns: opts.minTurns,
    });
  }
  if (isTrainingExampleShape(parsed)) {
    return [{ ...parsed, id: parsed.id || id, source: parsed.source || source }];
  }
  if (isShareGptShape(parsed)) {
    return [fromShareGpt(parsed, id, source, opts.defaultCharacterName)];
  }
  if (isChatMlShape(parsed)) {
    return [fromChatMl(parsed, id, source, opts.defaultCharacterName)];
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
  let results: TrainingExample[] = [];
  const names = requestedNames(opts);

  if (ext === ".jsonl") {
    let i = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      i += 1;
      try {
        results.push(...normalizeParsed(JSON.parse(line), `${base}-${i}`, source, opts));
      } catch {
        console.warn(`[import] ${base}: skipping malformed JSONL line ${i}`);
      }
    }
    results = applyCharacterSplit(results, names);
  } else if (ext === ".json") {
    try {
      const parsed = JSON.parse(raw);
      if (isAnimaBackup(parsed)) {
        results.push(...normalizeParsed(parsed, base, source, opts));
      } else {
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        arr.forEach((item, i) => {
          results.push(...normalizeParsed(item, `${base}-${i}`, source, opts));
        });
        results = applyCharacterSplit(results, names);
      }
    } catch (err) {
      console.warn(`[import] skipping malformed JSON file ${base}: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    if (names && names.length > 1) {
      const example = fromTranscriptText(raw, base, source, undefined);
      if (example) results.push(...splitExampleByCharacters(example, names));
    } else {
      const example = fromTranscriptText(raw, base, source, names?.[0] || opts.defaultCharacterName);
      if (example) results.push(example);
    }
  }

  return results
    .filter((ex) => ex.conversation.filter((t) => t.role !== "system").length >= minTurns)
    .map((ex) => (opts.tags?.length ? { ...ex, tags: [...(ex.tags || []), ...opts.tags] } : ex));
}

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "checkpoints", "gguf"]);

async function listSupportedFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      out.push(...(await listSupportedFiles(full)));
      continue;
    }
    if (entry.name.toLowerCase() === "readme.md") continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
  return out;
}

/** Parse every supported file in a directory (recursive) into TrainingExamples. Missing dir → []. */
export async function importLogsDir(
  dir: string,
  opts: ImportLogsOptions = {},
): Promise<TrainingExample[]> {
  const files = await listSupportedFiles(dir);
  const examples: TrainingExample[] = [];
  for (const file of files) {
    examples.push(...(await importLogFile(file, opts)));
  }
  return examples;
}
