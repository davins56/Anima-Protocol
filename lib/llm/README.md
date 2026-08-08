# `@workspace/llm`

Anima LLM build kit: model registry, embeddings/retrieval helpers, dataset export, and CLI.

**Product path:** a self-hosted chat LLM from **public open weights** (not ChatGPT / Gemini / Groq). Bootstrap with Ollama + Qwen2.5 → `anima-chat`; upgrade with Ministral 3 8B fine-tune on GPU.

## Commands

```bash
pnpm llm:up                                          # bootstrap anima-chat via Ollama
pnpm llm:chat -- "Who are you?"
pnpm --filter @workspace/llm run test
pnpm --filter @workspace/llm run cli -- list-models --provider ollama
pnpm --filter @workspace/llm run cli -- prepare-finetune --format sharegpt --val-split 0.05
pnpm --filter @workspace/llm run cli -- dataset-stats --file scripts/llm/output/finetune-sharegpt.jsonl
pnpm --filter @workspace/llm run cli -- serve-hint
```

Root shortcuts: `pnpm llm:up`, `pnpm llm:chat`, `pnpm llm:prepare-finetune`, `pnpm llm:serve-hint`, `pnpm llm:test`.

### Data quality pipeline (`src/dataset/clean.ts`)

Both `prepare-finetune` and `export-turns` run every example through a cleaning pass
before writing JSONL — on by default, opt out with `--no-clean` / `--no-dedupe`:

- **Normalize** — trims whitespace, drops empty turns, redacts obvious PII
  (emails, phone numbers), and merges consecutive same-role turns so
  conversations strictly alternate (chat templates require this).
- **Quality gate** — drops examples with no assistant turn, assistant turns
  shorter than `--min-assistant-chars` (default 4), assistant content matching
  a known error/fallback/refusal denylist (e.g. provider timeouts, generic
  "as an AI language model" boilerplate), or a repeated/echoed assistant reply.
  Every drop is logged with its reason, so bad data is visible, not silent.
- **Dedupe** — drops exact/near-duplicate conversations (case/whitespace-insensitive).
- **Split** — `--val-split 0.05` writes a deterministic held-out `*.val.jsonl`
  alongside the train file (bucketed by a stable hash of each example's id, so
  the split doesn't shuffle between re-exports). Feed it to
  `scripts/llm/finetune/unsloth_sft.py --eval-data <val file>` for real eval loss.

Run `dataset-stats --file <path>` on any exported (or externally cleaned/merged)
JSONL to sanity-check turn counts, assistant reply length, and flag any
denylisted or duplicate rows before you spend GPU time training on it.

## Packages surface

| Export | Contents |
|--------|----------|
| `@workspace/llm` | Registry, embeddings, hybrid memory retrieval |
| `@workspace/llm/dataset` | Transcripts, formatters, seed examples |
| `@workspace/llm/cli` | Offline tooling entry |

See [`docs/custom-llm.md`](../../docs/custom-llm.md) and [`docs/llm-build.md`](../../docs/llm-build.md).
