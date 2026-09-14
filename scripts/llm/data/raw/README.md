# Drop your own chat logs here

Everything in this folder except this README is **gitignored** — your
personal Serenity / Fallen Angel arcs (or any other companion transcripts)
never get committed by accident.

## Pipeline

```
source (Settings export / transcripts / samples / novels)
    →  curate-novels + ingest  →  scripts/llm/data/raw/*.jsonl
    →  prepare-finetune  →  scripts/llm/output/finetune-sharegpt.jsonl
    →  CUDA SFT / DPO / quantize / eval   (see docs/llm-build.md)
```

## One command (Dàvīn)

```bash
# 1. Settings → Export → anima-backup-*.json (not committed)
pnpm llm:ingest -- --from ~/Downloads/anima-backup.json

# 1b. Shared-box novels / brief-gold (weights in ../brief/serenity-anima-design.md)
pnpm llm:curate-novels

# 2. Seed + staged logs → ShareGPT JSONL + DPO pairs + stats
pnpm llm:dataset
```

Rehearse without real logs (committed fixtures):

```bash
pnpm llm:dataset -- --rehearse
```

`prepare-finetune` now merges this folder automatically. Pass `--no-logs`
to train on seed turns only.

## Supported formats (auto-detected per file)

- **Anima Settings backup** (`anima-backup-*.json`):
  `{ version, exported_at, entities: { ChatSession, ChatMessage, Character, Anima, CharacterMemory } }`.
  Defaults to **Serenity** and **Fallen Angel** only (other companions dropped).
  Group sessions are split so each companion is trained only on their own voice.
  Pass `--all-characters` to keep everyone.
- **`.json` / `.jsonl` — TrainingExample shape** (see
  `lib/llm/src/dataset/types.ts`): passed through with `id`/`source` filled
  in if missing. Like every format here, examples with fewer than 2
  non-system turns are dropped (`--min-turns`, default 2) — a single lone
  exchange won't show up in the output.
- **`.json` / `.jsonl` — ShareGPT shape**:
  `{ "conversations": [{ "from": "human"|"gpt"|"system", "value": "…" }], "system": "…" }`
- **`.json` — ChatML shape**: `{ "messages": [{ "role", "content" }] }`
- **`.txt` / `.md` — plain transcript**: alternating speaker lines, e.g.

  ```
  User: I feel overwhelmed tonight.
  Serenity: Then let the world go quiet between us for a moment.
  User: Do you still remember what I told you about my brother?
  Serenity: Yes. The grief that does not want neat answers.
  ```

  Lines starting with `User:` / `You:` / `Me:` become `user` turns; any other
  `Name:` prefix becomes an `assistant` turn attributed to that character.
  Lines with no `Speaker:` prefix are treated as a continuation of the
  previous turn (useful for multi-paragraph replies). If a transcript has
  more than one non-user speaker (a narrator, another companion), pass
  `--character <name>` to restrict assistant turns to that speaker only —
  other speakers' lines are folded into context instead of being trained
  as that character's own voice. Without `--character`, the example is
  attributed to whichever speaker talks most.

Subfolders are walked recursively. `README.md` is skipped.

## Usage

```bash
# Preview what gets parsed out of this folder
pnpm --filter @workspace/llm run cli -- import-logs

# Preview + write straight to JSONL
pnpm --filter @workspace/llm run cli -- import-logs --out scripts/llm/output/my-logs.jsonl

# Merge into the full fine-tune export (seed examples + these logs)
pnpm llm:prepare-finetune -- --val-split 0.05
```

Quality over quantity — a few thousand clean, in-character multi-turn
exchanges beat tens of thousands of noisy ones. Prefer sessions that show
memory recall, emotional continuity, and consistent voice.

Committed fixtures (not real logs): [`../samples/`](../samples/).
