# Sample logs (committed fixtures)

These are **synthetic** Serenity / Fallen Angel turns for rehearsing the
data → train path. They are not Dàvīn's real chats.

Real exports are personal and stay gitignored under
`scripts/llm/data/raw/`. Do not copy real logs into this folder.

## What's here

| File | Format |
|------|--------|
| `anima-backup.serenity-fallen-angel.json` | Settings → Export shape (`entities.ChatSession` + `ChatMessage` + `Character` + `CharacterMemory`) |
| `serenity-comfort.txt` | Plain transcript |
| `fallen-angel-voice.txt` | Plain transcript |
| `sharegpt-serenity.json` | ShareGPT JSON |
| `chatml-fallen-angel.json` | ChatML `{ messages }` JSON |
| `novels/*.txt` | Synthetic Speaker: scenes tagged by book + register |

## Rehearse the pipeline (no GPU, no real logs)

```bash
pnpm llm:dataset -- --rehearse
# curate samples/novels → scripts/llm/data/raw/curated-novels.jsonl (brief-gold stays in seeds)
# ingest chat samples → scripts/llm/data/raw/imported-samples.jsonl
# prepare-finetune (seed + logs, val split 0.05, register weights)
# prepare-dpo
# dataset-stats
```

## Drop real logs

1. Settings → Export → `anima-backup-*.json`
2. `pnpm llm:ingest -- --from ~/Downloads/anima-backup-….json`
3. `pnpm llm:dataset`  (uses staged raw + seeds)

See [`docs/llm-build.md`](../../../docs/llm-build.md).
