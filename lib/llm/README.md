# `@workspace/llm`

Anima LLM build kit: model registry, embeddings/retrieval helpers, dataset export, and CLI.

## Commands

```bash
pnpm --filter @workspace/llm run test
pnpm --filter @workspace/llm run cli -- list-models --provider vllm
pnpm --filter @workspace/llm run cli -- prepare-finetune --format sharegpt
pnpm --filter @workspace/llm run cli -- serve-hint
```

Root shortcuts: `pnpm llm:prepare-finetune`, `pnpm llm:serve-hint`, `pnpm llm:test`.

## Packages surface

| Export | Contents |
|--------|----------|
| `@workspace/llm` | Registry, embeddings, hybrid memory retrieval |
| `@workspace/llm/dataset` | Transcripts, formatters, seed examples |
| `@workspace/llm/cli` | Offline tooling entry |

See [`docs/llm-build.md`](../../docs/llm-build.md) for the full fine-tune + serve guide.
