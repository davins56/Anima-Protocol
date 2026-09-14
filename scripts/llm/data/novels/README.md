# Novel / extract drops (gitignored)

Put operator copies of the source novels here if you do not want them at
the repo root. **Never commit full novel text.**

Preferred drop locations (first matching book id with extracted scenes wins):

1. `llm-raw/` — Upgrade v2 PDFs (canonical; nested folders walked)
2. `llm-raw-source/` — plain-text extracts (used if a PDF is missing or yields no scenes)
3. `serenity-extract/`
4. This folder
5. `scripts/llm/data/samples/novels/` — committed synthetic fixtures

Then:

```bash
pnpm llm:curate-novels
pnpm llm:dataset
```

Weights and voice rules: [`../brief/serenity-anima-design.md`](../brief/serenity-anima-design.md).
`fallen-angel` is world lore only — not Serenity voice SFT.
