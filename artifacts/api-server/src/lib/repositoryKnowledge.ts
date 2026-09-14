import fs from "node:fs/promises";
import path from "node:path";
import { embedTexts, hashEmbed } from "@workspace/llm";

type RepositoryChunk = {
  file: string;
  text: string;
  embedding: number[];
};

let cachedIndex: Promise<RepositoryChunk[]> | null = null;

const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
]);

const extensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
]);

async function findRepositoryRoot(): Promise<string> {
  const candidates = [
    process.env.ANIMA_REPOSITORY_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const entries = await fs.readdir(candidate);
      if (entries.includes("package.json") && entries.includes("artifacts")) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return process.cwd();
}

async function collectFiles(
  directory: string,
  root: string,
  result: Array<{ file: string; text: string }>,
): Promise<void> {
  if (result.length >= 400) return;

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (result.length >= 400 || ignored.has(entry.name)) continue;

    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectFiles(absolute, root, result);
      continue;
    }

    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) {
      continue;
    }

    try {
      const stat = await fs.stat(absolute);
      if (stat.size > 250_000) continue;

      const text = await fs.readFile(absolute, "utf8");
      if (text.trim()) {
        result.push({
          file: path.relative(root, absolute),
          text,
        });
      }
    } catch {
      // Ignore unreadable files.
    }
  }
}

function chunkText(text: string, size = 1400, overlap = 200): string[] {
  const chunks: string[] = [];

  for (let start = 0; start < text.length; start += size - overlap) {
    const chunk = text.slice(start, start + size).trim();
    if (chunk) chunks.push(chunk);
    if (start + size >= text.length) break;
  }

  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;

  let dot = 0;
  let left = 0;
  let right = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    left += a[i]! * a[i]!;
    right += b[i]! * b[i]!;
  }

  return left && right ? dot / Math.sqrt(left * right) : 0;
}

async function buildIndex(): Promise<RepositoryChunk[]> {
  const root = await findRepositoryRoot();
  const files: Array<{ file: string; text: string }> = [];

  await collectFiles(root, root, files);

  const chunks = files.flatMap(({ file, text }) =>
    chunkText(text).map((chunk) => ({ file, text: chunk })),
  );

  const limited = chunks.slice(0, 1200);
  if (!limited.length) return [];

  try {
    const result = await embedTexts(limited.map((chunk) => chunk.text));

    return limited.map((chunk, index) => ({
      ...chunk,
      embedding: result.embeddings[index] || hashEmbed(chunk.text),
    }));
  } catch {
    return limited.map((chunk) => ({
      ...chunk,
      embedding: hashEmbed(chunk.text),
    }));
  }
}

async function getIndex(): Promise<RepositoryChunk[]> {
  if (!cachedIndex) {
    cachedIndex = buildIndex().catch((error) => {
      cachedIndex = null;
      throw error;
    });
  }

  return cachedIndex;
}

/**
 * Ordinary companion turns must not walk the source tree. RAG is opt-in via
 * `include_repository_knowledge`, ANIMA_REPOSITORY_RAG=true, or a turn that
 * is actually about this repo / codebase.
 */
const REPOSITORY_TURN_RE =
  /\b(?:this repo(?:sitory)?|the repo(?:sitory)?|our repo(?:sitory)?|the codebase|source tree|monorepo|wrangler\.jsonc?|ANIMA_LOCAL_LLM|artifacts\/(?:api-server|anima-protocol)|lib\/db|pnpm (?:build|install|test|typecheck)|repository (?:context|knowledge|rag)|anima-protocol\.com)\b/i;

export function looksLikeRepositoryTurn(query: string): boolean {
  return REPOSITORY_TURN_RE.test(String(query || ""));
}

export function shouldRetrieveRepositoryKnowledge(
  query: string,
  options?: { explicit?: boolean | null },
): boolean {
  if (process.env.ANIMA_REPOSITORY_RAG === "false") return false;
  if (!String(query || "").trim()) return false;
  if (options?.explicit === true) return true;
  if (process.env.ANIMA_REPOSITORY_RAG === "true") return true;
  return looksLikeRepositoryTurn(query);
}

export async function retrieveRepositoryKnowledge(
  query: string,
  limit = 6,
): Promise<string> {
  if (process.env.ANIMA_REPOSITORY_RAG === "false") return "";
  if (!query.trim()) return "";

  const index = await getIndex();
  if (!index.length) return "";

  let queryEmbedding: number[];

  try {
    queryEmbedding =
      (await embedTexts([query])).embeddings[0] || hashEmbed(query);
  } catch {
    queryEmbedding = hashEmbed(query);
  }

  const matches = index
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (!matches.length) return "";

  return [
    "Repository context retrieved from the Anima Protocol source tree:",
    ...matches.map((match) => `\n[${match.file}]\n${match.text}`),
    "\nUse this context only as repository reference.",
  ].join("\n");
}

export function resetRepositoryKnowledgeIndexForTests(): void {
  cachedIndex = null;
}