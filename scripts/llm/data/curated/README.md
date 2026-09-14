# Curated SFT rows (inspectable)

`pnpm llm:curate-novels` writes here:

| File | Git | What |
|------|-----|------|
| `brief-gold.jsonl` / `.json` | committed | Original Serenity voice turns from the design brief (porch, with-not-obeyed, fear, consent ledger, doorway, synchro/keys, seraph clinical-gentle, fallen-circuit withhold, slipthk trust-gated) |
| `novels.jsonl` | gitignored | Scenes extracted from operator novels / samples |
| `novels-and-brief.jsonl` | gitignored | Combined bundle also copied to `../raw/curated-novels-and-brief.jsonl` |

Weights live in `lib/llm/src/dataset/catalog.ts`. `fallen-angel` is excluded from Serenity SFT unless `--include-lore`.
