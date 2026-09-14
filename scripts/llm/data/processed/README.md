# Processed fine-tune artifacts

`prepare-finetune` / `prepare-dpo` write JSONL here:

| File | Producer |
|------|----------|
| `../output/finetune-sharegpt.jsonl` | `pnpm llm:prepare-finetune` |
| `../output/finetune-sharegpt.val.jsonl` | `--val-split 0.05` |
| `../output/dpo-pairs.jsonl` | `pnpm llm:prepare-dpo` |

Those files are gitignored. This folder exists so the source → raw →
processed path is visible in the tree. Do not commit personal transcripts.
