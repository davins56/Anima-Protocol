# Drop your own chat logs here

Everything in this folder except this README is **gitignored** — your
personal Serenity / Fallen Angel arcs (or any other companion transcripts)
never get committed by accident.

## Supported formats (auto-detected per file)

- **`.json` / `.jsonl` — TrainingExample shape** (see
  `lib/llm/src/dataset/types.ts`): passed through as-is.
- **`.json` / `.jsonl` — ShareGPT shape**:
  `{ "conversations": [{ "from": "human"|"gpt"|"system", "value": "…" }], "system": "…" }`
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
  previous turn (useful for multi-paragraph replies).

## Usage

```bash
# Preview what gets parsed out of this folder
pnpm --filter @workspace/llm run cli -- import-logs

# Preview + write straight to JSONL
pnpm --filter @workspace/llm run cli -- import-logs --out scripts/llm/output/my-logs.jsonl

# Merge into the full fine-tune export (seed examples + these logs)
pnpm --filter @workspace/llm run cli -- prepare-finetune --with-logs scripts/llm/data/raw
```

Quality over quantity — a few thousand clean, in-character multi-turn
exchanges beat tens of thousands of noisy ones. Prefer sessions that show
memory recall, emotional continuity, and consistent voice.
