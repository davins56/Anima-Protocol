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
  ANIMA_PRIMARY_MODEL,
  describeModel,
  listModels,
  resolveProvider,
  type ProviderName,
} from "./registry";
import {
  listSeedExamples,
  toJsonl,
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
  prepare-finetune [--format sharegpt|chatml|alpaca|messages] [--out path] [--tags a,b]
  serve-hint
  seed-stats

Examples:
  pnpm --filter @workspace/llm run cli -- prepare-finetune --format sharegpt
  pnpm --filter @workspace/llm run cli -- export-turns --out scripts/llm/output/turns.jsonl
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

async function cmdListModels(args: string[]): Promise<void> {
  const provider = resolveProvider(argValue(args, "--provider"));
  console.log(`Provider: ${provider}`);
  for (const spec of listModels(provider)) {
    console.log(describeModel(spec));
  }
}

async function cmdPrepareFinetune(args: string[]): Promise<void> {
  const format = (argValue(args, "--format") || "sharegpt") as ExportFormat;
  const out = resolveOutPath(
    argValue(args, "--out") ||
      path.join("scripts", "llm", "output", `finetune-${format}.jsonl`),
  );
  const tagsRaw = argValue(args, "--tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

  let examples: TrainingExample[] = listSeedExamples(tags);

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

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, toJsonl(examples, format), "utf8");
  console.log(`Wrote ${examples.length} examples → ${out} (${format})`);
  console.log(`Primary fine-tune target: ${ANIMA_PRIMARY_MODEL}`);
}

async function cmdExportTurns(args: string[]): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("export-turns requires DATABASE_URL");
  }
  const { exportTranscripts } = await import("./dataset/transcripts");
  const out = resolveOutPath(
    argValue(args, "--out") || path.join("scripts", "llm", "output", "turns.jsonl"),
  );
  const examples = await exportTranscripts({
    userId: argValue(args, "--user"),
    limit: Number(argValue(args, "--limit") || 200),
    minTurns: Number(argValue(args, "--min-turns") || 4),
  });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, toJsonl(examples, "messages"), "utf8");
  console.log(`Exported ${examples.length} sessions → ${out}`);
}

async function cmdServeHint(): Promise<void> {
  const provider = resolveProvider(process.env.ANIMA_LLM_PROVIDER) as ProviderName;
  console.log(`Resolved registry provider: ${provider}`);
  console.log(`
Local serving options:

1) vLLM (recommended throughput, OpenAI-compatible):
   docker compose -f scripts/llm/docker-compose.vllm.yml up
   export ANIMA_LLM_PROVIDER=local-first
   export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:8000/v1
   export ANIMA_VLLM_MODEL_STANDARD=${ANIMA_PRIMARY_MODEL}

2) Ollama (simpler single-user):
   ollama create anima-qwen27b -f scripts/llm/Modelfile.anima-qwen27b
   export ANIMA_LLM_PROVIDER=local-first
   export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
   export ANIMA_VLLM_MODEL_STANDARD=anima-qwen27b

Hybrid safety net:
  ANIMA_LLM_PROVIDER=local-first   # try local, fall back to Gemini→Kimi→Grok→OpenAI
  ANIMA_LLM_PROVIDER=local         # local only
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
    case "serve-hint":
      await cmdServeHint();
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
