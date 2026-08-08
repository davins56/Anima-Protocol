#!/usr/bin/env node
/**
 * Anima LLM CLI
 *
 *   pnpm --filter @workspace/llm run cli -- export-turns --out data/turns.jsonl
 *   pnpm --filter @workspace/llm run cli -- prepare-finetune --format sharegpt
 *   pnpm --filter @workspace/llm run cli -- list-models --provider vllm
 *   pnpm --filter @workspace/llm run cli -- serve-hint
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANIMA_BOOTSTRAP_BASE_MODEL,
  ANIMA_FINETUNE_BASE_MODEL,
  ANIMA_OLLAMA_CHAT_TAG,
  ANIMA_OLLAMA_TAG,
  ANIMA_PRIMARY_MODEL,
  describeModel,
  listModels,
  resolveProvider,
  type ProviderName,
} from "./registry";
import {
  cleanExamples,
  dedupeExamples,
  hasDenylistedAssistantContent,
  listSeedExamples,
  splitExamples,
  toJsonl,
  type ChatTurn,
  type ExportFormat,
  type TrainingExample,
} from "./dataset";

/** Monorepo root (…/lib/llm/src → ../../..) so CLI paths are cwd-independent. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function resolveOutPath(out: string): string {
  return path.isAbsolute(out) ? out : path.resolve(REPO_ROOT, out);
}

function usage(): never {
  console.log(`Anima LLM CLI

Commands:
  list-models [--provider vllm|ollama|openai|groq|mock]
  export-turns [--out path] [--user <clerkUserId>] [--limit N] [--min-turns N]
               [--no-clean] [--min-assistant-chars N]
  import-logs [--dir path] [--character name] [--tags a,b] [--out path] [--format …]
  prepare-finetune [--format sharegpt|chatml|alpaca|messages] [--out path] [--tags a,b]
               [--with-db] [--user <clerkUserId>] [--no-clean] [--no-dedupe]
               [--min-assistant-chars N] [--val-split 0.0-0.5]
               [--with-logs dir] [--character name]
  dataset-stats [--file path]   Quality/shape report on an exported JSONL
  chat [prompt…]          One-shot chat against local Anima LLM (Ollama/vLLM)
  serve-hint
  seed-stats

export-turns / prepare-finetune drop error/denylisted turns, redact obvious
PII (emails, phone numbers), and de-duplicate near-identical conversations by
default. Pass --no-clean / --no-dedupe to skip either step.

Examples:
  pnpm llm:up                               # bootstrap open-weight anima-chat
  pnpm llm:chat -- "Who are you?"
  pnpm --filter @workspace/llm run cli -- prepare-finetune --format sharegpt
`);
  process.exit(1);
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

const SUPPORTED_FORMATS: ExportFormat[] = ["sharegpt", "chatml", "alpaca", "messages"];

function parseFormat(raw: string | undefined): ExportFormat {
  const format = raw || "sharegpt";
  if (!SUPPORTED_FORMATS.includes(format as ExportFormat)) {
    throw new Error(`Unsupported --format "${format}" (expected one of: ${SUPPORTED_FORMATS.join(", ")})`);
  }
  return format as ExportFormat;
}

async function cmdListModels(args: string[]): Promise<void> {
  const provider = resolveProvider(argValue(args, "--provider"));
  console.log(`Provider: ${provider}`);
  for (const spec of listModels(provider)) {
    console.log(describeModel(spec));
  }
}

/** Shared clean+dedupe pass, reporting what was dropped so bad data is visible, not silent. */
function applyQualityPipeline(
  examples: TrainingExample[],
  args: string[],
): TrainingExample[] {
  const noClean = hasFlag(args, "--no-clean");
  const noDedupe = hasFlag(args, "--no-dedupe");
  const minAssistantChars = Number(argValue(args, "--min-assistant-chars") || 4);

  let result = examples;
  if (!noClean) {
    const dropped: string[] = [];
    result = cleanExamples(result, {
      minAssistantChars,
      onDrop: (ex, reason) => dropped.push(`${ex.id}: ${reason}`),
    });
    if (dropped.length) {
      console.log(`Dropped ${dropped.length} low-quality example(s):`);
      for (const line of dropped.slice(0, 20)) console.log(`  - ${line}`);
      if (dropped.length > 20) console.log(`  ... and ${dropped.length - 20} more`);
    }
  }
  if (!noDedupe) {
    const before = result.length;
    result = dedupeExamples(result);
    if (result.length < before) {
      console.log(`Deduped ${before - result.length} near-duplicate example(s)`);
    }
  }
  return result;
}

async function writeSplitJsonl(
  out: string,
  examples: TrainingExample[],
  format: ExportFormat,
  valRatio: number,
): Promise<void> {
  await mkdir(path.dirname(out), { recursive: true });
  const { train, val } = splitExamples(examples, valRatio);
  await writeFile(out, toJsonl(train, format), "utf8");
  console.log(`Wrote ${train.length} train example(s) → ${out} (${format})`);
  if (valRatio > 0) {
    const valOut = out.replace(/(\.jsonl)?$/, (m) => `.val${m || ".jsonl"}`);
    await writeFile(valOut, toJsonl(val, format), "utf8");
    console.log(`Wrote ${val.length} val example(s)   → ${valOut} (${format})`);
  }
}

async function cmdPrepareFinetune(args: string[]): Promise<void> {
  const format = parseFormat(argValue(args, "--format"));
  const out = resolveOutPath(
    argValue(args, "--out") ||
      path.join("scripts", "llm", "output", `finetune-${format}.jsonl`),
  );
  const tagsRaw = argValue(args, "--tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
  const valSplit = Number(argValue(args, "--val-split") || 0);

  let examples: TrainingExample[] = listSeedExamples(tags);

  // Optionally merge your own cleaned logs (Serenity / Fallen Angel arcs, …).
  const logsDir = argValue(args, "--with-logs");
  if (logsDir) {
    const { importLogsDir } = await import("./dataset/import");
    const fromLogs = await importLogsDir(resolveOutPath(logsDir), {
      tags,
      defaultCharacterName: argValue(args, "--character"),
    });
    console.log(`Imported ${fromLogs.length} examples from ${logsDir}`);
    examples = [...examples, ...fromLogs];
  }

  // Optionally merge DB transcripts when --with-db is set.
  if (hasFlag(args, "--with-db")) {
    if (!process.env.DATABASE_URL) {
      throw new Error("--with-db requires DATABASE_URL");
    }
    const { exportTranscripts } = await import("./dataset/transcripts");
    const fromDb = await exportTranscripts({
      userId: argValue(args, "--user"),
      limit: Number(argValue(args, "--limit") || 200),
      minTurns: Number(argValue(args, "--min-turns") || 4),
    });
    examples = [...examples, ...fromDb];
  }

  examples = applyQualityPipeline(examples, args);
  await writeSplitJsonl(out, examples, format, valSplit);
  console.log(`Fine-tune base: ${ANIMA_FINETUNE_BASE_MODEL}`);
  console.log(`Serve target:   ${ANIMA_PRIMARY_MODEL}`);
}

async function cmdExportTurns(args: string[]): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("export-turns requires DATABASE_URL");
  }
  const { exportTranscripts } = await import("./dataset/transcripts");
  const out = resolveOutPath(
    argValue(args, "--out") || path.join("scripts", "llm", "output", "turns.jsonl"),
  );
  let examples = await exportTranscripts({
    userId: argValue(args, "--user"),
    limit: Number(argValue(args, "--limit") || 200),
    minTurns: Number(argValue(args, "--min-turns") || 4),
  });
  examples = applyQualityPipeline(examples, args);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, toJsonl(examples, "messages"), "utf8");
  console.log(`Exported ${examples.length} session(s) → ${out}`);
}

/** Turns extracted from an already-formatted JSONL row, for dataset-stats. */
function extractTurns(row: Record<string, unknown>): ChatTurn[] {
  if (Array.isArray(row.messages)) {
    return (row.messages as Array<Record<string, unknown>>).map((m) => ({
      role: (m.role as ChatTurn["role"]) || "user",
      content: String(m.content ?? ""),
    }));
  }
  if (Array.isArray(row.conversations)) {
    const roleMap: Record<string, ChatTurn["role"]> = {
      system: "system",
      human: "user",
      gpt: "assistant",
    };
    return (row.conversations as Array<Record<string, unknown>>).map((c) => ({
      role: roleMap[String(c.from)] || "user",
      content: String(c.value ?? ""),
    }));
  }
  if (typeof row.output === "string") {
    const turns: ChatTurn[] = [];
    if (row.instruction) turns.push({ role: "user", content: String(row.instruction) });
    turns.push({ role: "assistant", content: String(row.output) });
    return turns;
  }
  return [];
}

async function cmdDatasetStats(args: string[]): Promise<void> {
  const file = resolveOutPath(
    argValue(args, "--file") || path.join("scripts", "llm", "output", "finetune-sharegpt.jsonl"),
  );
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(file, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (!lines.length) {
    console.log(`${file}: 0 examples`);
    return;
  }

  let assistantChars: number[] = [];
  let turnCounts: number[] = [];
  let denylistHits = 0;
  const dedupeKeys = new Set<string>();
  let duplicates = 0;

  for (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown>;
    const turns = extractTurns(row).filter((t) => t.role !== "system");
    turnCounts.push(turns.length);
    for (const t of turns) {
      if (t.role === "assistant") assistantChars.push(t.content.trim().length);
    }
    if (hasDenylistedAssistantContent(turns)) denylistHits++;
    const key = turns.map((t) => `${t.role}:${t.content.trim().toLowerCase()}`).join("|");
    if (dedupeKeys.has(key)) duplicates++;
    dedupeKeys.add(key);
  }

  const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);
  const fmt = (n: number) => n.toFixed(1);

  console.log(`${file}: ${lines.length} examples`);
  console.log(`  turns/example:            avg ${fmt(avg(turnCounts))}, min ${Math.min(...turnCounts)}, max ${Math.max(...turnCounts)}`);
  if (assistantChars.length) {
    console.log(
      `  assistant chars/turn:     avg ${fmt(avg(assistantChars))}, min ${Math.min(...assistantChars)}, max ${Math.max(...assistantChars)}`,
    );
  }
  console.log(`  flagged (denylist match): ${denylistHits}`);
  console.log(`  exact/near duplicates:    ${duplicates}`);
  if (denylistHits || duplicates) {
    console.log(`  → re-run with prepare-finetune/export-turns (cleaning is on by default) to drop these`);
  }
}

async function cmdImportLogs(args: string[]): Promise<void> {
  const dir = resolveOutPath(argValue(args, "--dir") || path.join("scripts", "llm", "data", "raw"));
  const { importLogsDir } = await import("./dataset/import");
  const character = argValue(args, "--character");
  const tagsRaw = argValue(args, "--tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

  const examples = await importLogsDir(dir, { defaultCharacterName: character, tags });
  console.log(`Parsed ${examples.length} training example(s) from ${dir}`);
  for (const ex of examples) {
    const turns = ex.conversation.filter((t) => t.role !== "system").length;
    console.log(`- ${ex.id} [${ex.character.name}] turns=${turns}`);
  }
  if (!examples.length) {
    console.log(
      `No logs found. Drop .json (TrainingExample or ShareGPT) / .jsonl / .txt transcripts into ${dir} and re-run.`,
    );
    return;
  }

  const out = argValue(args, "--out");
  if (out) {
    const format = parseFormat(argValue(args, "--format"));
    const outPath = resolveOutPath(out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, toJsonl(examples, format), "utf8");
    console.log(`Wrote ${examples.length} examples → ${outPath} (${format})`);
  } else {
    console.log(`Re-run with --out <path> to write these to JSONL, or use prepare-finetune --with-logs ${dir}.`);
  }
}

async function cmdChat(args: string[]): Promise<void> {
  const base = (
    process.env.ANIMA_LOCAL_LLM_BASE_URL ||
    process.env.OLLAMA_BASE_URL ||
    "http://127.0.0.1:11434/v1"
  )
    .trim()
    .replace(/\/$/, "");
  const root = base.endsWith("/v1") ? base : `${base}/v1`;
  const model =
    process.env.ANIMA_OLLAMA_MODEL_STANDARD ||
    process.env.ANIMA_VLLM_MODEL_STANDARD ||
    ANIMA_OLLAMA_CHAT_TAG;
  const prompt =
    args.join(" ").trim() ||
    "In one short sentence, introduce yourself as the Anima Protocol LLM.";

  const res = await fetch(`${root}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANIMA_LOCAL_LLM_API_KEY || "local"}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are the Anima Protocol companion LLM. Answer briefly and in character.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 160,
      temperature: 0.85,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Chat failed (${res.status}): ${text}\nRun: bash scripts/llm/bootstrap-anima-llm.sh`,
    );
  }
  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty completion from local Anima LLM");
  console.log(content);
  console.error(`\n[model=${data.model || model} base=${root}]`);
}

async function cmdServeHint(): Promise<void> {
  const provider = resolveProvider(process.env.ANIMA_LLM_PROVIDER) as ProviderName;
  console.log(`Resolved registry provider: ${provider}`);
  console.log(`
Build / run the Anima LLM (replaces ChatGPT / Gemini / Groq for chat):

ChatGPT, Gemini, and Groq do not publish their model weights. Anima uses
public open weights + local serving instead.

1) Bootstrap (CPU / laptop — works today):
   bash scripts/llm/bootstrap-anima-llm.sh
   # pulls ${ANIMA_BOOTSTRAP_BASE_MODEL}, creates ${ANIMA_OLLAMA_CHAT_TAG}
   export ANIMA_LOCAL_LLM_BACKEND=ollama
   export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
   export ANIMA_OLLAMA_MODEL_STANDARD=${ANIMA_OLLAMA_CHAT_TAG}
   pnpm llm:chat -- "Who are you?"

2) GPU upgrade (Ministral 3 8B fine-tune → vLLM):
   docker compose -f scripts/llm/docker-compose.vllm.yml up
   export ANIMA_LOCAL_LLM_BACKEND=vllm
   export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
   export ANIMA_VLLM_MODEL_STANDARD=${ANIMA_PRIMARY_MODEL}

3) GPU Ollama (after GGUF convert of LoRA merge):
   ollama create ${ANIMA_OLLAMA_TAG} -f scripts/llm/Modelfile.anima-ministral8b
   export ANIMA_OLLAMA_MODEL_STANDARD=${ANIMA_OLLAMA_TAG}

Fine-tune (LoRA on CUDA):
  python scripts/llm/finetune/unsloth_sft.py \\
    --data scripts/llm/output/finetune-sharegpt.jsonl \\
    --base ${ANIMA_FINETUNE_BASE_MODEL}

Chat has exactly one backend — ANIMA_LOCAL_LLM_BASE_URL above. There is no
mode switch and no cloud fallback; ANIMA_LOCAL_LLM_BACKEND only picks which
local server (ollama or vllm) that URL points at.
`);
}

async function cmdSeedStats(): Promise<void> {
  const seeds = listSeedExamples();
  console.log(`Seed examples: ${seeds.length}`);
  for (const s of seeds) {
    console.log(`- ${s.id} [${(s.tags || []).join(", ")}] turns=${s.conversation.length}`);
  }
}

async function main(): Promise<void> {
  // pnpm forwards a leading `--` when invoked as `pnpm run cli -- <cmd>`.
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const cmd = args[0];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();

  switch (cmd) {
    case "list-models":
      await cmdListModels(args.slice(1));
      break;
    case "prepare-finetune":
      await cmdPrepareFinetune(args.slice(1));
      break;
    case "export-turns":
      await cmdExportTurns(args.slice(1));
      break;
    case "dataset-stats":
      await cmdDatasetStats(args.slice(1));
      break;
    case "import-logs":
      await cmdImportLogs(args.slice(1));
      break;
    case "serve-hint":
      await cmdServeHint();
      break;
    case "chat":
      await cmdChat(args.slice(1));
      break;
    case "seed-stats":
      await cmdSeedStats();
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
