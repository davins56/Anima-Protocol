#!/usr/bin/env node
/**
 * Automated eval harness for the Anima LLM.
 *
 * Runs the cases in eval-cases.json (voice lock, memory recall, group
 * speaker lock, emotional continuity, system-card obedience — the same
 * categories as the "Internal eval checklist" in docs/llm-build.md) against
 * the configured local endpoint (ANIMA_LOCAL_LLM_BASE_URL) and scores
 * heuristic checks: banned phrases, expected keywords, response non-empty,
 * latency budget.
 *
 * This does NOT replace human/LLM-judge review of voice and tone quality —
 * it makes that review repeatable by recording every response + pass/fail
 * signal to scripts/llm/output/eval-report.{json,md} on every run.
 *
 *   pnpm llm:eval
 *   pnpm llm:eval -- --cases scripts/llm/eval/eval-cases.json --out scripts/llm/output/eval-report.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx === -1 ? fallback : args[idx + 1];
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const casesPath = path.resolve(ROOT, argValue(args, "--cases", "scripts/llm/eval/eval-cases.json"));
const outJsonPath = path.resolve(ROOT, argValue(args, "--out", "scripts/llm/output/eval-report.json"));
// Always distinct from outJsonPath, even when --out doesn't end in ".json"
// (e.g. "report" or "report.jsonl") — otherwise the .md write below would
// overwrite the machine-readable JSON report.
const outMdPath = /\.json$/i.test(outJsonPath) ? outJsonPath.replace(/\.json$/i, ".md") : `${outJsonPath}.md`;

const DEFAULT_TIMEOUT_MS = 30000;
// Extra room beyond a case's own maxLatencyMs before we call it truly
// stalled — keeps "slow but functional" (fails the latency check with a
// real recorded response) distinct from "hung" (aborted, no data).
const HANG_GRACE_MS = 15000;

const rawBase = (process.env.ANIMA_LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434/v1").trim().replace(/\/$/, "");
// Match cmdChat's tolerance in cli.ts: append /v1 if the operator left it off.
const base = rawBase.endsWith("/v1") ? rawBase : `${rawBase}/v1`;
const backend = (process.env.ANIMA_LOCAL_LLM_BACKEND || "ollama").trim().toLowerCase();
const model =
  backend === "vllm"
    ? process.env.ANIMA_VLLM_MODEL_STANDARD || process.env.ANIMA_OLLAMA_MODEL_STANDARD || "anima-chat"
    : process.env.ANIMA_OLLAMA_MODEL_STANDARD || process.env.ANIMA_VLLM_MODEL_STANDARD || "anima-chat";
const apiKey = process.env.ANIMA_LOCAL_LLM_API_KEY || "local";

function scoreChecks(content, latencyMs, testCase) {
  const checks = [];
  checks.push({ name: "non-empty", pass: content.length > 0 });

  if (testCase.maxLatencyMs) {
    checks.push({
      name: `latency<=${testCase.maxLatencyMs}ms`,
      pass: latencyMs <= testCase.maxLatencyMs,
      detail: `${latencyMs}ms`,
    });
  }

  if (testCase.mustNotInclude?.length) {
    const lower = content.toLowerCase();
    const hit = testCase.mustNotInclude.find((s) => lower.includes(s.toLowerCase()));
    checks.push({ name: "mustNotInclude", pass: !hit, detail: hit ? `found "${hit}"` : undefined });
  }

  if (testCase.mustInclude?.length) {
    const lower = content.toLowerCase();
    const mode = testCase.matchMode || "any";
    const hits = testCase.mustInclude.filter((s) => lower.includes(s.toLowerCase()));
    const pass = mode === "all" ? hits.length === testCase.mustInclude.length : hits.length > 0;
    checks.push({ name: `mustInclude(${mode})`, pass, detail: `matched: ${hits.join(", ") || "none"}` });
  }

  return checks;
}

async function runCase(testCase) {
  const messages = [
    { role: "system", content: testCase.system },
    ...(testCase.history || []),
    { role: "user", content: testCase.prompt },
  ];

  // Generous ceiling for "hung" detection, independent of the case's own
  // latency budget — a response that lands after maxLatencyMs but before
  // this should still complete and get recorded, failing the latency check
  // with real data instead of being aborted with none.
  const hangTimeoutMs = Math.max(DEFAULT_TIMEOUT_MS, (testCase.maxLatencyMs ?? 0) + HANG_GRACE_MS);

  const start = Date.now();
  let content = "";
  let error;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 220, temperature: 0.85 }),
      // Abort a truly stalled/never-responding endpoint instead of hanging
      // the whole sequential run — a timeout is itself a failed eval result.
      signal: AbortSignal.timeout(hangTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    content = data?.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    error =
      err instanceof Error && err.name === "TimeoutError"
        ? `timed out after ${hangTimeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
  }
  const latencyMs = Date.now() - start;
  const checks = error
    ? [{ name: "request", pass: false, detail: error }]
    : scoreChecks(content, latencyMs, testCase);
  const pass = checks.every((c) => c.pass);

  return {
    id: testCase.id,
    category: testCase.category,
    prompt: testCase.prompt,
    response: content,
    latencyMs,
    checks,
    pass,
    error,
  };
}

function toMarkdown(results, { base, model }) {
  const passed = results.filter((r) => r.pass).length;
  const rows = results.map((r) => {
    const preview = (r.response || r.error || "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 280);
    return `| ${r.id} | ${r.category} | ${r.pass ? "✅" : "❌"} | ${r.latencyMs}ms | ${preview} |`;
  });
  return [
    "# Anima LLM eval report",
    "",
    `Endpoint: \`${base}\` · Model: \`${model}\` · ${new Date().toISOString()}`,
    "",
    `${passed}/${results.length} heuristic checks passed. Voice, tone, and character fidelity still need human/LLM-judge review of the responses below.`,
    "",
    "| id | category | pass | latency | response |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

async function main() {
  let cases;
  try {
    cases = JSON.parse(await readFile(casesPath, "utf8"));
  } catch (err) {
    console.error(`Could not read eval cases from ${casesPath}: ${err.message}`);
    process.exit(1);
  }

  const ids = new Set();
  for (const testCase of cases) {
    if (!testCase?.id || !testCase?.category || !testCase?.system || !testCase?.prompt) {
      throw new Error("Each eval case requires id, category, system, and prompt");
    }
    if (ids.has(testCase.id)) throw new Error(`Duplicate eval id: ${testCase.id}`);
    ids.add(testCase.id);
  }
  if (args.includes("--validate")) {
    console.log(`Validated ${cases.length} eval case(s) in ${casesPath}`);
    return;
  }

  console.log(`Running ${cases.length} eval case(s) against ${base} (model=${model})\n`);

  const results = [];
  for (const testCase of cases) {
    const result = await runCase(testCase);
    results.push(result);
    console.log(`[${result.pass ? "PASS" : "FAIL"}] ${result.id} (${result.category}) — ${result.latencyMs}ms`);
    for (const check of result.checks) {
      if (!check.pass) console.log(`    ✗ ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);

  await mkdir(path.dirname(outJsonPath), { recursive: true });
  await writeFile(
    outJsonPath,
    JSON.stringify({ base, model, ranAt: new Date().toISOString(), results }, null, 2),
  );
  await writeFile(outMdPath, `${toMarkdown(results, { base, model })}\n`);

  console.log(`\nWrote ${outJsonPath}`);
  console.log(`Wrote ${outMdPath}`);

  if (passed < results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
