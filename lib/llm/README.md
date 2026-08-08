# `@workspace/llm`

Anima LLM build kit: model registry, embeddings/retrieval helpers, dataset export, and CLI.

**Product path:** a self-hosted chat LLM from **public open weights** (not ChatGPT / Gemini / Groq). Bootstrap with Ollama + Qwen2.5 → `anima-chat`; upgrade with Ministral 3 8B fine-tune on GPU.

## Commands

```bash
pnpm llm:up                                          # bootstrap anima-chat via Ollama
pnpm llm:chat -- "Who are you?"
pnpm --filter @workspace/llm run test
pnpm --filter @workspace/llm run cli -- list-models --provider ollama
pnpm --filter @workspace/llm run cli -- import-logs               # preview scripts/llm/data/raw/*
pnpm --filter @workspace/llm run cli -- prepare-finetune --format sharegpt --with-logs scripts/llm/data/raw
pnpm --filter @workspace/llm run cli -- serve-hint
pnpm llm:eval                                        # run docs/llm-build.md's eval checklist
pnpm llm:verify-deploy -- https://your-deployment.example.com
```

Root shortcuts: `pnpm llm:up`, `pnpm llm:chat`, `pnpm llm:prepare-finetune`, `pnpm llm:serve-hint`, `pnpm llm:test`, `pnpm llm:eval`, `pnpm llm:verify-deploy`.

## Packages surface

| Export | Contents |
|--------|----------|
| `@workspace/llm` | Registry, embeddings, hybrid memory retrieval |
| `@workspace/llm/dataset` | Transcripts, formatters, seed examples |
| `@workspace/llm/cli` | Offline tooling entry |

See [`docs/custom-llm.md`](../../docs/custom-llm.md) and [`docs/llm-build.md`](../../docs/llm-build.md).
