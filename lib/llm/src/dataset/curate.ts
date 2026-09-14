/**
 * Walk operator novel drops + committed samples, tag by book/register, and
 * stage TrainingExample JSONL into curated/ (inspect) and raw/ (train merge).
 *
 * Full novels stay out of git. Brief-gold (original voice turns) is always
 * mixed in unless --no-brief-gold. Brief-gold is written to curated/ for
 * inspection but is NOT copied into raw/ — prepare-finetune already loads it
 * via listSeedExamples, and a second copy would 8× after the 4× gold weight.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BRIEF_GOLD_EXAMPLES } from "./briefGold";
import {
  bookSpecForFilename,
  DEFAULT_NOVEL_DIRS,
  type BookId,
  type BookSpec,
} from "./catalog";
import { extractNovelExamples } from "./novels";
import type { TrainingExample } from "./types";

const execFileAsync = promisify(execFile);

export type CurateNovelsResult = {
  scannedDirs: string[];
  files: Array<{ path: string; book: string; register: string; turns: number }>;
  examples: TrainingExample[];
  missingSources: string[];
  usedBriefGold: boolean;
  skippedBooks: BookId[];
};

const SOURCE_EXTENSIONS = new Set([".txt", ".md", ".pdf"]);
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "checkpoints", "gguf"]);

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (entry.name.toLowerCase() === "readme.md") continue;
      if (!SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      out.push(full);
    }
  }
  await walk(dir);
  return out;
}

/** lib/llm/src/dataset → repo root (four levels). */
export const REPO_ROOT_FROM_DATASET = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function defaultCuratedDir(): string {
  return join(REPO_ROOT_FROM_DATASET, "scripts/llm/data/curated");
}

export function defaultRawDir(): string {
  return join(REPO_ROOT_FROM_DATASET, "scripts/llm/data/raw");
}

export function resolveRepoPath(p: string, repoRoot = REPO_ROOT_FROM_DATASET): string {
  return isAbsolute(p) ? p : resolve(repoRoot, p);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function textFromPdf(file: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", file, "-"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return String(stdout || "");
  } catch {
    console.warn(
      `[curate] cannot pdftotext ${basename(file)} — install poppler-utils or drop a .txt extract`,
    );
    return "";
  }
}

async function readSourceText(file: string): Promise<string> {
  if (extname(file).toLowerCase() === ".pdf") return textFromPdf(file);
  return readFile(file, "utf8");
}

export async function curateNovels(opts: {
  searchDirs?: string[];
  repoRoot?: string;
  includeLore?: boolean;
  includeBriefGold?: boolean;
}): Promise<CurateNovelsResult> {
  const repoRoot = opts.repoRoot || REPO_ROOT_FROM_DATASET;
  const searchDirs = (opts.searchDirs?.length ? opts.searchDirs : DEFAULT_NOVEL_DIRS).map((d) =>
    resolveRepoPath(d, repoRoot),
  );
  const scannedDirs: string[] = [];
  const files: CurateNovelsResult["files"] = [];
  const examples: TrainingExample[] = [];
  const missingSources: string[] = [];
  const seenBooks = new Set<BookId>();
  const skippedBooks: BookId[] = [];

  for (const dir of searchDirs) {
    if (!(await pathExists(dir))) {
      missingSources.push(dir);
      continue;
    }
    scannedDirs.push(dir);
    for (const file of await listSourceFiles(dir)) {
      const spec = bookSpecForFilename(basename(file));
      if (!spec) continue;
      if (seenBooks.has(spec.id)) continue;
      if (spec.role === "lore-only" && !opts.includeLore) {
        seenBooks.add(spec.id);
        skippedBooks.push(spec.id);
        files.push({ path: file, book: spec.id, register: spec.register, turns: 0 });
        continue;
      }
      const text = await readSourceText(file);
      if (!text.trim()) {
        files.push({ path: file, book: spec.id, register: spec.register, turns: 0 });
        continue;
      }
      const extracted = extractNovelExamples(text, spec);
      files.push({
        path: file,
        book: spec.id,
        register: spec.register,
        turns: extracted.length,
      });
      // Unreadable / scene-less PDFs must not lock the book id — txt extracts
      // in a later dir (llm-raw-source, serenity-extract) should still win.
      if (!extracted.length) continue;
      seenBooks.add(spec.id);
      examples.push(...extracted);
    }
  }

  const usedBriefGold = opts.includeBriefGold !== false;
  if (usedBriefGold) {
    examples.push(...BRIEF_GOLD_EXAMPLES);
  }

  return { scannedDirs, files, examples, missingSources, usedBriefGold, skippedBooks };
}

export async function writeCuratedBundle(opts: {
  examples: TrainingExample[];
  curatedDir: string;
  rawDir?: string;
}): Promise<{
  briefJsonl: string;
  novelsJsonl: string;
  allJsonl: string;
  rawCopy?: string;
  counts: { brief: number; novels: number; all: number };
}> {
  await mkdir(opts.curatedDir, { recursive: true });
  const brief = opts.examples.filter((ex) => ex.source === "brief-gold");
  const novels = opts.examples.filter((ex) => ex.source !== "brief-gold");
  const briefJsonl = join(opts.curatedDir, "brief-gold.jsonl");
  const novelsJsonl = join(opts.curatedDir, "novels.jsonl");
  const allJsonl = join(opts.curatedDir, "novels-and-brief.jsonl");
  const briefJson = join(opts.curatedDir, "brief-gold.json");

  await writeFile(briefJsonl, toJsonlRows(brief));
  await writeFile(briefJson, JSON.stringify(brief, null, 2) + "\n");
  await writeFile(novelsJsonl, toJsonlRows(novels));
  await writeFile(allJsonl, toJsonlRows(opts.examples));

  let rawCopy: string | undefined;
  if (opts.rawDir) {
    await mkdir(opts.rawDir, { recursive: true });
    rawCopy = join(opts.rawDir, "curated-novels.jsonl");
    await writeFile(rawCopy, toJsonlRows(novels));
    // Previous builds staged brief-gold here too; remove so prepare-finetune
    // cannot mix a second copy with listSeedExamples.
    try {
      await unlink(join(opts.rawDir, "curated-novels-and-brief.jsonl"));
    } catch {
      // missing is fine
    }
  }

  return {
    briefJsonl,
    novelsJsonl,
    allJsonl,
    rawCopy,
    counts: { brief: brief.length, novels: novels.length, all: opts.examples.length },
  };
}

function toJsonlRows(examples: TrainingExample[]): string {
  if (!examples.length) return "";
  return examples.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export { type BookSpec };
