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
  listPreferenceExamples,
  listSeedExamples,
  preferencesToJsonl,
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
  prepare-dpo [--out path] [--tags a,b]   Preference pairs for DPO/ORPO/SimPO
  chat [prompt…]          One-shot chat against local Anima LLM (Ollama/vLLM)
  serve-hint
  seed-stats

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
  console.log(`Fine-tune base: ${ANIMA_FINETUNE_BASE_MODEL}`);
  console.log(`Serve target:   ${ANIMA_PRIMARY_MODEL}`);
}

async function cmdPrepareDpo(args: string[]): Promise<void> {
  const out = resolveOutPath(
    argValue(args, "--out") || path.join("scripts", "llm", "output", "dpo-pairs.jsonl"),
  );
  const tagsRaw = argValue(args, "--tags");
  const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : undefined;

  const preferences = listPreferenceExamples(tags);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, preferencesToJsonl(preferences), "utf8");
  console.log(`Wrote ${preferences.length} preference pairs → ${out}`);
  console.log(
    "Run: python scripts/llm/finetune/unsloth_dpo.py --data " + path.relative(REPO_ROOT, out),
  );
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
   export ANIMA_LLM_PROVIDER=custom
   export ANIMA_LOCAL_LLM_BACKEND=ollama
   export ANIMA_LOCAL_LLM_BASE_URL=http://localhost:11434/v1
   export ANIMA_OLLAMA_MODEL_STANDARD=${ANIMA_OLLAMA_CHAT_TAG}
   pnpm llm:chat -- "Who are you?"

2) GPU upgrade (Ministral 3 8B fine-tune → vLLM):
   docker compose -f scripts/llm/docker-compose.vllm.yml up
   export ANIMA_LLM_PROVIDER=custom
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

Modes:
  ANIMA_LLM_PROVIDER=custom   # self-hosted Anima LLM only (recommended)
  ANIMA_LLM_PROVIDER=local    # same as custom
  ANIMA_LLM_PROVIDER=local-first  # local, then optional cloud BYOK if keys exist
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
    case "prepare-dpo":
      await cmdPrepareDpo(args.slice(1));
      break;
    case "export-turns":
      await cmdExportTurns(args.slice(1));
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
