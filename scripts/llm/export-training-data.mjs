/**
 * Thin wrapper — prefer the typed CLI:
 *   pnpm llm:prepare-finetune
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2] || "scripts/llm/output/finetune-sharegpt.jsonl";

const result = spawnSync(
  "pnpm",
  ["--filter", "@workspace/llm", "run", "cli", "--", "prepare-finetune", "--format", "sharegpt", "--out", out],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
